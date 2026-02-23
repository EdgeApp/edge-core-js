import { Disklet, DiskletListing } from 'disklet'
import { bridgifyObject, onMethod, update, watchMethod } from 'yaob'

import { InternalWalletMethods, streamTransactions } from '../../client-side'
import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgeBalances,
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetReceiveAddressOptions,
  EdgeGetTransactionsOptions,
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeResult,
  EdgeSaveTxActionOptions,
  EdgeSaveTxMetadataOptions,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeSplitCurrencyWallet,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeSyncStatus,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../types/types'
import {
  createDelegatingOtherMethods,
  makeRealObjectPoller
} from './cache-utils'
import { CachedWallet, PARENT_CURRENCY_KEY } from './cache-wallet-cleaners'

/**
 * Sync ratio returned by cached wallets to indicate "partially loaded" state.
 * Using 0.05 shows visual progress in the UI (not 0% or 100%) while engines sync.
 */
const CACHE_MODE_SYNC_RATIO = 0.05

/** Number of characters to show when logging wallet IDs */
const WALLET_ID_DISPLAY_LENGTH = 8

/** Default batch size for streaming transactions */
const DEFAULT_BATCH_SIZE = 10

/**
 * Options for creating a cached wallet.
 */
export interface CachedWalletOptions {
  /** Callback to get the real wallet for delegation */
  getRealWallet?: () => EdgeCurrencyWallet | undefined
  /** If true, cached wallets start paused (matching real wallet behavior) */
  pauseWallets?: boolean
}

/**
 * Result of creating a cached wallet.
 */
export interface CachedWalletResult {
  wallet: EdgeCurrencyWallet
  cleanup: () => void
}

/**
 * Creates a delegating disklet that forwards all operations to the real
 * wallet's disklet when available. This ensures cached wallets don't use
 * memory disklets that would lose data.
 *
 * The returned disklet is bridged for yaob serialization.
 */
function makeDelegatingDisklet(
  tryGetRealWallet: () => EdgeCurrencyWallet | undefined,
  waitForRealWallet: () => Promise<EdgeCurrencyWallet>,
  diskletKey: 'disklet' | 'localDisklet'
): Disklet {
  const disklet: Disklet = {
    async delete(path: string): Promise<unknown> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].delete(path)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].delete(path)
    },
    async getData(path: string): Promise<Uint8Array> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].getData(path)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].getData(path)
    },
    async getText(path: string): Promise<string> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].getText(path)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].getText(path)
    },
    async list(path?: string): Promise<DiskletListing> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].list(path)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].list(path)
    },
    async setData(path: string, data: ArrayLike<number>): Promise<unknown> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].setData(path, data)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].setData(path, data)
    },
    async setText(path: string, text: string): Promise<unknown> {
      const immediate = tryGetRealWallet()
      if (immediate != null) {
        return await immediate[diskletKey].setText(path, text)
      }
      const realWallet = await waitForRealWallet()
      return await realWallet[diskletKey].setText(path, text)
    }
  }
  return bridgifyObject(disklet)
}

/**
 * Creates a cached EdgeCurrencyWallet that provides instant read-only data.
 * Methods that require the real wallet will delegate if available, or wait
 * for the real wallet to load via a shared polling promise.
 */
export function makeCachedCurrencyWallet(
  cacheData: CachedWallet,
  currencyInfo: EdgeCurrencyInfo,
  currencyConfig: EdgeCurrencyConfig,
  options: CachedWalletOptions = {}
): CachedWalletResult {
  const { getRealWallet, pauseWallets = false } = options
  const {
    id: walletId,
    type,
    name,
    fiatCurrencyCode,
    balances,
    enabledTokenIds,
    otherMethodNames,
    created: createdString,
    publicWalletInfo: cachedPublicWalletInfo
  } = cacheData

  const shortId = walletId.slice(0, WALLET_ID_DISPLAY_LENGTH)
  const parsedDate = new Date(createdString)
  const createdDate = isNaN(parsedDate.getTime()) ? undefined : parsedDate

  // Track mutable state locally. When the GUI calls a setter, we update
  // the local value immediately and call update(wallet) to push it
  // through yaob to the GUI side. Without this, yaob's client-side proxy
  // would cache the old getter value indefinitely since no pixie calls
  // update() on cached wallet objects.
  let localPaused = pauseWallets
  let localName: string | undefined = name
  let localFiatCurrencyCode = fiatCurrencyCode
  let localEnabledTokenIds = enabledTokenIds

  // Shared poller: single poll loop for all callers, reuses the same promise
  const poller = makeRealObjectPoller<EdgeCurrencyWallet>(() => {
    if (getRealWallet == null) return undefined
    const realWallet = getRealWallet()
    // Don't delegate to self
    if (realWallet != null && realWallet !== wallet) {
      return realWallet
    }
    return undefined
  }, `wallet ${shortId}`)

  const {
    tryGet: tryGetRealWallet,
    waitFor: waitForRealWallet,
    cancel: cancelPoller
  } = poller

  /**
   * Delegates an async method call to the real wallet.
   * Checks synchronously first, then waits if needed.
   */
  async function delegate<R>(
    fn: (w: EdgeCurrencyWallet) => Promise<R>
  ): Promise<R> {
    const immediate = tryGetRealWallet()
    if (immediate != null) return await fn(immediate)
    return await fn(await waitForRealWallet())
  }

  // Build balance map from cached data
  const cachedBalanceMap: EdgeBalanceMap = new Map()
  const cachedBalancesObj: EdgeBalances = {}
  for (const [tokenIdStr, amount] of Object.entries(balances)) {
    const tokenId = tokenIdStr === PARENT_CURRENCY_KEY ? null : tokenIdStr
    cachedBalanceMap.set(tokenId, amount)

    // Get currency code for the balances object
    if (tokenId === null) {
      cachedBalancesObj[currencyInfo.currencyCode] = amount
    } else {
      const token = currencyConfig.allTokens[tokenId]
      if (token != null) {
        cachedBalancesObj[token.currencyCode] = amount
      }
    }
  }

  // Create delegating disklets that forward to the real wallet's disklets
  // when available. This prevents data loss from using memory disklets.
  const disklet = makeDelegatingDisklet(
    tryGetRealWallet,
    waitForRealWallet,
    'disklet'
  )
  const localDisklet = makeDelegatingDisklet(
    tryGetRealWallet,
    waitForRealWallet,
    'localDisklet'
  )

  // The wallet object includes internal methods for yaob compatibility
  // ($internalStreamTransactions is called by client-side streamTransactions)
  const wallet: EdgeCurrencyWallet & InternalWalletMethods = {
    // Note: watch/on callbacks registered on this cached wallet will not fire
    // from the pixie system (which only calls update() on real wallets).
    // Setters like renameWallet/setFiatCurrencyCode call update(wallet) to
    // push local changes through yaob, but watch/on won't fire reactively.
    // This is acceptable because:
    // - All getters delegate to the real wallet, so reads return live data.
    // - The GUI re-grabs wallets from `account.currencyWallets` on re-render,
    //   which swaps in the real wallet and triggers re-subscription.
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get created(): Date | undefined {
      return createdDate
    },
    get disklet() {
      return disklet
    },
    get id(): string {
      return walletId
    },
    get localDisklet() {
      return localDisklet
    },
    publicWalletInfo: cachedPublicWalletInfo as EdgeWalletInfo,
    async sync(): Promise<void> {
      return await delegate(async w => await w.sync())
    },
    get type(): string {
      return type
    },

    // Wallet name:
    get name(): string | null {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.name : localName ?? null
    },
    async renameWallet(newName: string): Promise<void> {
      await delegate(async w => await w.renameWallet(newName))
      localName = newName
      update(wallet)
    },

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      const realWallet = tryGetRealWallet()
      return realWallet != null
        ? realWallet.fiatCurrencyCode
        : localFiatCurrencyCode
    },
    async setFiatCurrencyCode(code: string): Promise<void> {
      await delegate(async w => await w.setFiatCurrencyCode(code))
      localFiatCurrencyCode = code
      update(wallet)
    },

    // Currency info:
    get currencyConfig(): EdgeCurrencyConfig {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.currencyConfig : currencyConfig
    },
    get currencyInfo(): EdgeCurrencyInfo {
      return currencyInfo
    },

    // Chain state (delegate to real wallet when available, otherwise use cached):
    get balanceMap(): EdgeBalanceMap {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.balanceMap : cachedBalanceMap
    },
    get balances(): EdgeBalances {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.balances : cachedBalancesObj
    },
    get blockHeight(): number {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.blockHeight : 0
    },
    get syncStatus(): EdgeSyncStatus {
      const realWallet = tryGetRealWallet()
      return realWallet != null
        ? realWallet.syncStatus
        : { totalRatio: CACHE_MODE_SYNC_RATIO }
    },
    get syncRatio(): number {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.syncRatio : CACHE_MODE_SYNC_RATIO
    },
    get unactivatedTokenIds(): string[] {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.unactivatedTokenIds : []
    },

    // Running state:
    // Paused starts from the login's pauseWallets option. When the GUI
    // calls changePaused, we update localPaused immediately and call
    // update(wallet) to propagate through yaob to the client side.
    // This ensures the GUI sees the paused change without needing a
    // pixie-driven update cycle.
    async changePaused(paused: boolean): Promise<void> {
      await delegate(async w => await w.changePaused(paused))
      localPaused = paused
      update(wallet)
    },
    get paused(): boolean {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.paused : localPaused
    },

    // Token management:
    async changeEnabledTokenIds(tokenIds: string[]): Promise<void> {
      await delegate(async w => await w.changeEnabledTokenIds(tokenIds))
      localEnabledTokenIds = tokenIds
      update(wallet)
    },
    get enabledTokenIds(): string[] {
      const realWallet = tryGetRealWallet()
      return realWallet != null
        ? realWallet.enabledTokenIds
        : localEnabledTokenIds
    },
    get detectedTokenIds(): string[] {
      const realWallet = tryGetRealWallet()
      return realWallet != null ? realWallet.detectedTokenIds : []
    },

    // Transaction history (delegates to real wallet):
    async getNumTransactions(opts: EdgeTokenIdOptions): Promise<number> {
      return await delegate(async w => await w.getNumTransactions(opts))
    },
    async getTransactions(
      opts: EdgeGetTransactionsOptions
    ): Promise<EdgeTransaction[]> {
      return await delegate(async w => await w.getTransactions(opts))
    },
    // Use the shared streamTransactions function from client-side.ts
    // This function calls $internalStreamTransactions on the bridged wallet
    streamTransactions,

    // Internal method used by yaob's client-side streamTransactions wrapper.
    // This follows the InternalWalletStream pattern from client-side.ts.
    async $internalStreamTransactions(
      opts: EdgeStreamTransactionOptions
    ): Promise<{
      next: () => Promise<{ done: boolean; value: EdgeTransaction[] }>
    }> {
      const realWallet = await waitForRealWallet()

      // Double cast needed: $internalStreamTransactions is an internal
      // bridge method not on the public EdgeCurrencyWallet type.
      const internalMethod = (
        realWallet as unknown as Partial<InternalWalletMethods>
      ).$internalStreamTransactions

      if (internalMethod != null) {
        return await internalMethod.call(realWallet, opts)
      }

      // Fallback: create a stream from getTransactions
      const transactions = await realWallet.getTransactions(opts)
      let index = 0
      return {
        next: async () => {
          if (index >= transactions.length) {
            return { done: true, value: [] }
          }
          const batch = transactions.slice(
            index,
            index + (opts.batchSize ?? DEFAULT_BATCH_SIZE)
          )
          index += batch.length
          return { done: false, value: batch }
        }
      }
    },

    // Addresses (delegates to real wallet):
    async getAddresses(
      opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeAddress[]> {
      return await delegate(async w => await w.getAddresses(opts))
    },

    // Sending (delegates to real wallet):
    async broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      return await delegate(async w => await w.broadcastTx(tx))
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
      return await delegate(async w => await w.getMaxSpendable(spendInfo))
    },
    async getPaymentProtocolInfo(
      url: string
    ): Promise<EdgePaymentProtocolInfo> {
      return await delegate(async w => await w.getPaymentProtocolInfo(url))
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return await delegate(async w => await w.makeSpend(spendInfo))
    },
    async saveTx(tx: EdgeTransaction): Promise<void> {
      return await delegate(async w => await w.saveTx(tx))
    },
    async saveTxAction(opts: EdgeSaveTxActionOptions): Promise<void> {
      return await delegate(async w => await w.saveTxAction(opts))
    },
    async saveTxMetadata(opts: EdgeSaveTxMetadataOptions): Promise<void> {
      return await delegate(async w => await w.saveTxMetadata(opts))
    },
    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      return await delegate(async w => await w.signTx(tx))
    },
    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return await delegate(async w => await w.sweepPrivateKeys(spendInfo))
    },

    // Signing (delegates to real wallet):
    async signBytes(
      bytes: Uint8Array,
      opts?: EdgeSignMessageOptions
    ): Promise<string> {
      return await delegate(async w => await w.signBytes(bytes, opts))
    },

    // Accelerating (delegates to real wallet):
    async accelerate(tx: EdgeTransaction): Promise<EdgeTransaction | null> {
      return await delegate(async w => await w.accelerate(tx))
    },

    // Staking (delegate to real wallet when available):
    get stakingStatus(): EdgeStakingStatus {
      const realWallet = tryGetRealWallet()
      return realWallet != null
        ? realWallet.stakingStatus
        : { stakedAmounts: [] }
    },

    // Wallet management (delegates to real wallet):
    async dumpData(): Promise<EdgeDataDump> {
      return await delegate(async w => await w.dumpData())
    },
    async resyncBlockchain(): Promise<void> {
      return await delegate(async w => await w.resyncBlockchain())
    },
    async split(
      splitWallets: EdgeSplitCurrencyWallet[]
    ): Promise<Array<EdgeResult<EdgeCurrencyWallet>>> {
      return await delegate(async w => await w.split(splitWallets))
    },

    // URI handling (delegates to real wallet for proper implementation):
    async encodeUri(obj: EdgeEncodeUri): Promise<string> {
      return await delegate(async w => await w.encodeUri(obj))
    },
    async parseUri(uri: string, currencyCode?: string): Promise<EdgeParsedUri> {
      return await delegate(async w => await w.parseUri(uri, currencyCode))
    },

    // Generic - create delegating stubs for otherMethods
    // These are bridged by yaob and callable by the GUI
    otherMethods: createDelegatingOtherMethods(
      otherMethodNames,
      () => tryGetRealWallet()?.otherMethods,
      waitForRealWallet,
      true // bridgify for wallet otherMethods
    ),

    // Deprecated methods (delegate to real wallet):
    async denominationToNative(
      amount: string,
      currencyCode: string
    ): Promise<string> {
      return await delegate(
        async w => await w.denominationToNative(amount, currencyCode)
      )
    },
    async nativeToDenomination(
      amount: string,
      currencyCode: string
    ): Promise<string> {
      return await delegate(
        async w => await w.nativeToDenomination(amount, currencyCode)
      )
    },
    async getReceiveAddress(
      opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeReceiveAddress> {
      return await delegate(async w => await w.getReceiveAddress(opts))
    },
    async lockReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      return await delegate(
        async w => await w.lockReceiveAddress(receiveAddress)
      )
    },
    async saveReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      return await delegate(
        async w => await w.saveReceiveAddress(receiveAddress)
      )
    },
    async signMessage(
      message: string,
      opts?: EdgeSignMessageOptions
    ): Promise<string> {
      return await delegate(async w => await w.signMessage(message, opts))
    }
  }

  return { wallet: bridgifyObject(wallet), cleanup: cancelPoller }
}

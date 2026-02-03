import { makeMemoryDisklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

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
  EdgeSaveTxActionOptions,
  EdgeSaveTxMetadataOptions,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../types/types'
import { CachedWallet } from './cache-wallet-cleaners'

const LOG_PREFIX = '[WalletCache]'

/**
 * Sync ratio returned by cached wallets to indicate "partially loaded" state.
 * Using 0.5 shows visual progress in the UI (not 0% or 100%) while engines sync.
 */
const CACHE_MODE_SYNC_RATIO = 0.5

/** Number of characters to show when logging wallet IDs */
const WALLET_ID_DISPLAY_LENGTH = 8

/** Default batch size for streaming transactions */
const DEFAULT_BATCH_SIZE = 10

/** Key used in balances map for the parent currency (null tokenId) */
const PARENT_CURRENCY_KEY = 'null'

/** How often to check if the real wallet is available (ms) */
const REAL_WALLET_POLL_INTERVAL = 100

/** Maximum time to wait for the real wallet before timing out (ms) */
const MAX_WAIT_FOR_REAL_WALLET_MS = 60000

/**
 * Callback to get the real wallet when it becomes available.
 * Returns undefined if the real wallet is not yet available.
 */
export type RealWalletGetter = () => EdgeCurrencyWallet | undefined

/**
 * Options for creating a cached wallet.
 */
export interface CachedWalletOptions {
  /** Callback to get the real wallet for delegation */
  getRealWallet?: RealWalletGetter
}

/**
 * Creates a cached EdgeCurrencyWallet that provides instant read-only data.
 * Methods that require the real wallet will delegate if available, or throw
 * a helpful error if the real wallet is still loading.
 */
export function makeCachedCurrencyWallet(
  cacheData: CachedWallet,
  currencyInfo: EdgeCurrencyInfo,
  currencyConfig: EdgeCurrencyConfig,
  options: CachedWalletOptions = {}
): EdgeCurrencyWallet {
  const { getRealWallet } = options
  const {
    id: walletId,
    type,
    name,
    fiatCurrencyCode,
    balances,
    enabledTokenIds
  } = cacheData

  const shortId = walletId.slice(0, WALLET_ID_DISPLAY_LENGTH)

  /**
   * Gets the real wallet if available, for delegation.
   */
  function tryGetRealWallet(): EdgeCurrencyWallet | undefined {
    if (getRealWallet == null) return undefined
    const realWallet = getRealWallet()
    // Don't delegate to self
    if (realWallet != null && realWallet !== wallet) {
      return realWallet
    }
    return undefined
  }

  /**
   * Waits for the real wallet to become available, then returns it.
   * This is used by methods that require the real wallet for delegation.
   * Times out after MAX_WAIT_FOR_REAL_WALLET_MS to prevent indefinite waiting.
   */
  async function waitForRealWallet(): Promise<EdgeCurrencyWallet> {
    // Check if already available
    const immediate = tryGetRealWallet()
    if (immediate != null) return immediate

    // Poll until real wallet is available, with timeout
    return await new Promise((resolve, reject) => {
      const startTime = Date.now()

      const check = (): void => {
        try {
          const realWallet = tryGetRealWallet()
          if (realWallet != null) {
            resolve(realWallet)
            return
          }

          // Check for timeout
          if (Date.now() - startTime > MAX_WAIT_FOR_REAL_WALLET_MS) {
            reject(
              new Error(
                `Timed out waiting for real wallet ${shortId} after ${MAX_WAIT_FOR_REAL_WALLET_MS}ms`
              )
            )
            return
          }

          // Schedule next check
          setTimeout(check, REAL_WALLET_POLL_INTERVAL)
        } catch (error) {
          reject(error)
        }
      }

      // Start polling
      setTimeout(check, REAL_WALLET_POLL_INTERVAL)
    })
  }

  // Build balance map from cached data
  const balanceMap: EdgeBalanceMap = new Map()
  const balancesObj: EdgeBalances = {}
  for (const [tokenIdStr, amount] of Object.entries(balances)) {
    const tokenId = tokenIdStr === PARENT_CURRENCY_KEY ? null : tokenIdStr
    balanceMap.set(tokenId, amount)

    // Get currency code for the balances object
    if (tokenId === null) {
      balancesObj[currencyInfo.currencyCode] = amount
    } else {
      const token = currencyConfig.allTokens[tokenId]
      if (token != null) {
        balancesObj[token.currencyCode] = amount
      }
    }
  }

  const publicWalletInfo: EdgeWalletInfo = {
    id: walletId,
    type,
    keys: {}
  }

  const stakingStatus: EdgeStakingStatus = { stakedAmounts: [] }

  // Create memory disklets
  const disklet = makeMemoryDisklet()
  const localDisklet = makeMemoryDisklet()

  // The wallet object includes internal methods for yaob compatibility
  // ($internalStreamTransactions is called by client-side streamTransactions)
  const wallet: EdgeCurrencyWallet & InternalWalletMethods = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get created(): Date | undefined {
      // Cached wallets don't have access to the actual creation date
      // Return undefined to indicate unknown creation time
      return undefined
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
    publicWalletInfo,
    async sync(): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.sync() called`)
    },
    get type(): string {
      return type
    },

    // Wallet name:
    get name(): string | null {
      return name ?? null
    },
    async renameWallet(_name: string): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.renameWallet() called`)
    },

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      return fiatCurrencyCode
    },
    async setFiatCurrencyCode(_code: string): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.setFiatCurrencyCode() called`)
    },

    // Currency info:
    get currencyConfig(): EdgeCurrencyConfig {
      return currencyConfig
    },
    get currencyInfo(): EdgeCurrencyInfo {
      return currencyInfo
    },

    // Chain state:
    get balanceMap(): EdgeBalanceMap {
      return balanceMap
    },
    get balances(): EdgeBalances {
      return balancesObj
    },
    get blockHeight(): number {
      return 0
    },
    get syncRatio(): number {
      // Return a value indicating cache-loaded state
      // Real wallet will report actual sync progress when available
      return CACHE_MODE_SYNC_RATIO
    },
    get unactivatedTokenIds(): string[] {
      return []
    },

    // Running state:
    async changePaused(_paused: boolean): Promise<void> {
      console.warn(
        `${LOG_PREFIX} ${shortId}.changePaused() - no-op on cached wallet`
      )
    },
    get paused(): boolean {
      return false
    },

    // Token management:
    async changeEnabledTokenIds(_tokenIds: string[]): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.changeEnabledTokenIds() called`)
    },
    get enabledTokenIds(): string[] {
      return enabledTokenIds
    },
    get detectedTokenIds(): string[] {
      return []
    },

    // Transaction history (delegates to real wallet):
    async getNumTransactions(opts: EdgeTokenIdOptions): Promise<number> {
      const realWallet = await waitForRealWallet()
      return await realWallet.getNumTransactions(opts)
    },
    async getTransactions(
      opts: EdgeGetTransactionsOptions
    ): Promise<EdgeTransaction[]> {
      const realWallet = await waitForRealWallet()
      return await realWallet.getTransactions(opts)
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

      // Call the real wallet's internal stream method
      const internalMethod = (
        realWallet as unknown as {
          $internalStreamTransactions?: (
            opts: EdgeStreamTransactionOptions
          ) => Promise<{
            next: () => Promise<{ done: boolean; value: EdgeTransaction[] }>
          }>
        }
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
      const realWallet = await waitForRealWallet()
      return await realWallet.getAddresses(opts)
    },

    // Sending (delegates to real wallet):
    async broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      const realWallet = await waitForRealWallet()
      return await realWallet.broadcastTx(tx)
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
      const realWallet = await waitForRealWallet()
      return await realWallet.getMaxSpendable(spendInfo)
    },
    async getPaymentProtocolInfo(
      url: string
    ): Promise<EdgePaymentProtocolInfo> {
      const realWallet = await waitForRealWallet()
      return await realWallet.getPaymentProtocolInfo(url)
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const realWallet = await waitForRealWallet()
      return await realWallet.makeSpend(spendInfo)
    },
    async saveTx(tx: EdgeTransaction): Promise<void> {
      const realWallet = await waitForRealWallet()
      return await realWallet.saveTx(tx)
    },
    async saveTxAction(opts: EdgeSaveTxActionOptions): Promise<void> {
      const realWallet = await waitForRealWallet()
      return await realWallet.saveTxAction(opts)
    },
    async saveTxMetadata(opts: EdgeSaveTxMetadataOptions): Promise<void> {
      const realWallet = await waitForRealWallet()
      return await realWallet.saveTxMetadata(opts)
    },
    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      const realWallet = await waitForRealWallet()
      return await realWallet.signTx(tx)
    },
    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const realWallet = await waitForRealWallet()
      return await realWallet.sweepPrivateKeys(spendInfo)
    },

    // Signing (delegates to real wallet):
    async signBytes(
      bytes: Uint8Array,
      opts?: EdgeSignMessageOptions
    ): Promise<string> {
      const realWallet = await waitForRealWallet()
      return await realWallet.signBytes(bytes, opts)
    },

    // Accelerating (delegates to real wallet):
    async accelerate(tx: EdgeTransaction): Promise<EdgeTransaction | null> {
      const realWallet = await waitForRealWallet()
      return await realWallet.accelerate(tx)
    },

    // Staking:
    get stakingStatus(): EdgeStakingStatus {
      return stakingStatus
    },

    // Wallet management (delegates to real wallet):
    async dumpData(): Promise<EdgeDataDump> {
      const realWallet = await waitForRealWallet()
      return await realWallet.dumpData()
    },
    async resyncBlockchain(): Promise<void> {
      const realWallet = await waitForRealWallet()
      return await realWallet.resyncBlockchain()
    },

    // URI handling (no engine needed):
    async encodeUri(_obj: EdgeEncodeUri): Promise<string> {
      console.warn(`${LOG_PREFIX} ${shortId}.encodeUri() called`)
      return ''
    },
    async parseUri(
      _uri: string,
      _currencyCode?: string
    ): Promise<EdgeParsedUri> {
      console.warn(`${LOG_PREFIX} ${shortId}.parseUri() called`)
      return {}
    },

    // Generic - empty object for cached wallets
    // GUI code should check if methods exist before calling them
    otherMethods: {},

    // Deprecated methods:
    async denominationToNative(
      _amount: string,
      _currencyCode: string
    ): Promise<string> {
      console.warn(`${LOG_PREFIX} ${shortId}.denominationToNative() called`)
      return '0'
    },
    async nativeToDenomination(
      _amount: string,
      _currencyCode: string
    ): Promise<string> {
      console.warn(`${LOG_PREFIX} ${shortId}.nativeToDenomination() called`)
      return '0'
    },
    async getReceiveAddress(
      _opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeReceiveAddress> {
      console.warn(`${LOG_PREFIX} ${shortId}.getReceiveAddress() called`)
      return {
        publicAddress: '',
        metadata: {
          bizId: 0,
          category: '',
          exchangeAmount: {},
          name: '',
          notes: ''
        },
        nativeAmount: '0'
      }
    },
    async lockReceiveAddress(
      _receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.lockReceiveAddress() called`)
    },
    async saveReceiveAddress(
      _receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      console.warn(`${LOG_PREFIX} ${shortId}.saveReceiveAddress() called`)
    },
    async signMessage(
      message: string,
      opts?: EdgeSignMessageOptions
    ): Promise<string> {
      const realWallet = await waitForRealWallet()
      return await realWallet.signMessage(message, opts)
    }
  }

  return bridgifyObject(wallet)
}

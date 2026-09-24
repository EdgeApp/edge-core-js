import { div, mul } from 'biggystring'
import { Disklet } from 'disklet'
import { isPixieShutdownError } from 'redux-pixies'
import { base64 } from 'rfc4648'
import { bridgifyObject, emit, onMethod, watchMethod } from 'yaob'

import {
  InternalWalletMethods,
  InternalWalletStream,
  streamTransactions
} from '../../../client-side'
import {
  upgradeCurrencyCode,
  upgradeTxNetworkFees
} from '../../../types/type-helpers'
import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgeBalances,
  EdgeCurrencyConfig,
  EdgeCurrencyEngine,
  EdgeCurrencyInfo,
  EdgeCurrencyTools,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetReceiveAddressOptions,
  EdgeGetTransactionsOptions,
  EdgeOtherMethods,
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeResult,
  EdgeSaveTxMetadataOptions,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeSplitCurrencyWallet,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeSyncStatus,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo,
  JsonObject
} from '../../../types/types'
import { compare } from '../../../util/compare'
import { makeMetaTokens } from '../../account/custom-tokens'
import { getAccountDatabase } from '../../db/account-database'
import { EdgeSqlDriver } from '../../db/db-driver'
import { splitWalletInfo } from '../../login/splitting'
import { getCurrencyTools } from '../../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../../root-pixie'
import { makeStorageWalletApi } from '../../storage/storage-api'
import {
  bumpEngineQueue,
  checkCurrencyWallet,
  getCurrencyMultiplier,
  waitForCurrencyEngine
} from '../currency-selectors'
import { makeCurrencyWalletCallbacks } from './currency-wallet-callbacks'
import {
  asEdgeAssetAction,
  asEdgeTxAction,
  asEdgeTxSwap
} from './currency-wallet-cleaners'
import {
  countTxsInDatabase,
  streamTxsFromDatabase
} from './currency-wallet-db-read'
import {
  renameCurrencyWallet,
  saveTxMetadataFile,
  saveWalletSettingsFile,
  setCurrencyWalletFiat,
  setupNewTxMetadata,
  updateCurrencyWalletTxMetadata
} from './currency-wallet-files'
import { CurrencyWalletInput } from './currency-wallet-pixie'
import { uniqueStrings } from './enabled-tokens'
import { getMaxSpendableInner } from './max-spend'
import { upgradeMemos } from './upgrade-memos'

const fakeMetadata = {
  bizId: 0,
  category: '',
  exchangeAmount: {},
  name: '',
  notes: ''
}

// The EdgeTransaction.spendTargets type, but non-null:
type SavedSpendTargets = EdgeTransaction['spendTargets']

/**
 * Creates an `EdgeCurrencyWallet` API object.
 */
export function makeCurrencyWalletApi(
  input: CurrencyWalletInput,
  publicWalletInfo: EdgeWalletInfo
): EdgeCurrencyWallet {
  const ai = toApiInput(input)
  const { walletId } = input.props
  const { accountId, pluginId, walletInfo } = input.props.walletState
  const plugin = input.props.state.plugins.currency[pluginId]
  const { unsafeBroadcastTx = false, unsafeMakeSpend = false } =
    plugin.currencyInfo

  /**
   * The wallet API object exists before the engine does,
   * so engine-backed methods wait for the engine internally.
   * Bail out if the wallet is deleted mid-wait, and re-throw
   * `engineFailure` so a broken plugin surfaces as a rejected
   * method call instead of a hang.
   */
  function getEngine(): Promise<EdgeCurrencyEngine> {
    return waitForCurrencyEngine(ai, walletId)
  }

  async function getTools(): Promise<EdgeCurrencyTools> {
    return await getCurrencyTools(ai, pluginId)
  }

  /**
   * Methods that write synced-repo files need the storage wallet,
   * not the engine. The repo loads well before the engine,
   * so this wait is much shorter than `getEngine`.
   * A ready repo always wins: an unrelated engine failure must not
   * break storage-backed methods, so the failure check only matters
   * while the repo is still missing (the engine pixie died before
   * `addStorageWallet`, so the repo is never coming).
   */
  function getStorage(): Promise<true> {
    // The repo loads inside the queued startup work, so a caller
    // waiting on storage wants this wallet at the front too:
    bumpEngineQueue(ai, walletId)

    return ai.waitFor((props: RootProps): true | undefined => {
      if (props.state.storageWallets[walletId] != null) return true
      checkCurrencyWallet(props, walletId)
    })
  }

  const storageWalletApi = makeStorageWalletApi(ai, walletInfo, props => {
    // Bails on deletion, and re-throws `engineFailure`: while the
    // repo is missing, a dead engine pixie means it is never coming.
    checkCurrencyWallet(props, walletId)
  })

  // Address queries that were answered from the cache before the
  // engine existed. Each one owes the caller a correction if the
  // engine turns out to disagree:
  const addressesServedFromCache = new Set<string>()

  /**
   * Remembers the engine's answer to the default address query, so
   * the cache saver persists it and the next warm login can serve it
   * pre-engine. Balances are stripped:
   * they are stale by definition and `balanceMap` already owns them.
   */
  function rememberAddresses(
    opts: EdgeGetReceiveAddressOptions,
    addresses: EdgeAddress[]
  ): void {
    if (opts.forceIndex != null) return
    const tokenIdKey = opts.tokenId ?? ''
    const stripped = addresses.map(address => ({
      addressType: address.addressType,
      publicAddress: address.publicAddress
    }))

    // If this query was served from the cache while the engine loaded,
    // its callers hold an address the engine may have replaced. Only
    // the first engine answer can settle that; later changes are
    // rotations, which the engine reports through its own callback:
    const owesCorrection = addressesServedFromCache.delete(tokenIdKey)
    const isStale =
      owesCorrection &&
      !compare(input.props.walletState.addresses[tokenIdKey] ?? [], stripped)

    input.props.dispatch({
      type: 'CURRENCY_WALLET_ADDRESSES_CHANGED',
      payload: {
        addresses: stripped,
        tokenId: opts.tokenId,
        walletId
      }
    })

    if (isStale) fakeCallbacks.onAddressChanged()
  }

  // Token queries with a reconcile already in flight. Several callers
  // can be served the same cached answer before the engine lands, and
  // one engine query settles the correction for all of them:
  const reconcilingAddresses = new Set<string>()

  /**
   * Asks the engine for an address query that was already answered
   * from the cache, so `rememberAddresses` can emit `addressChanged`
   * if the two disagree. At most one runs per token query: a second
   * would find the correction already settled and would silently
   * overwrite the stored addresses without telling anyone.
   */
  function reconcileAddresses(opts: EdgeGetReceiveAddressOptions): void {
    const tokenIdKey = opts.tokenId ?? ''
    if (reconcilingAddresses.has(tokenIdKey)) return
    reconcilingAddresses.add(tokenIdKey)

    getEngine()
      .then(async () => await out.getAddresses({ tokenId: opts.tokenId }))
      .catch(error => {
        // A logout destroys the pixie under the pending engine wait,
        // and a wallet deletion removes it from the state. Either is
        // teardown, not a failed reconcile, and the correction is
        // moot once the wallet is gone, so the app must not see a
        // leftover shutdown or wallet-missing error:
        if (isPixieShutdownError(error)) return
        if (ai.props.state.currency.wallets[walletId] == null) return
        input.props.onError(error)
      })
      .finally(() => reconcilingAddresses.delete(tokenIdKey))
  }

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  /**
   * The account's database.
   *
   * Looked up per call rather than captured, because it closes on logout and
   * a reference held here would outlive it.
   */
  const walletDatabase = (): EdgeSqlDriver =>
    getAccountDatabase(input, accountId).driver

  // The wallet's `otherMethods` is an object of delegating stubs:
  // each waits for the engine and then forwards, so a method can be
  // called the moment its NAME is known - from the cache on a warm
  // login (before the engine exists), or from the live engine
  // otherwise. The object keeps its identity as long as the known
  // name set is unchanged (the common warm-boot case, where the
  // cache already names every engine method); when a name first
  // appears it is REBUILT as a new bridgified object, because yaob
  // only serializes the properties an object had when it first
  // crossed the bridge - the pixie watcher's update() then delivers
  // the new object, exactly how the old engine-swap propagated.
  // Existing stubs carry over a rebuild, a name the loaded engine
  // turns out to lack rejects cleanly at call time, and pre-engine
  // with no cache this is `{}`, exactly the old guarantee, so
  // property probes stay safe.
  let otherMethodStubs: { [name: string]: (...args: any[]) => any } = {}
  bridgifyObject(otherMethodStubs)

  function makeOtherMethodStub(name: string): (...args: any[]) => any {
    return async (...args: any[]): Promise<any> => {
      // Resolve against the live engine on every call, so an engine
      // rebuilt by a resync never leaves a stale capture behind.
      // Calls go through the source object, preserving `this`:
      const engine = await getEngine()
      const withKeys = engine.otherMethodsWithKeys
      if (withKeys != null && typeof withKeys[name] === 'function') {
        return withKeys[name](walletInfo.keys, ...args)
      }
      const methods = engine.otherMethods
      if (methods != null && typeof methods[name] === 'function') {
        return methods[name](...args)
      }
      throw new Error(`The wallet engine does not implement "${name}"`)
    }
  }

  function syncOtherMethodStubs(): EdgeOtherMethods {
    const names = [...input.props.walletState.otherMethodNames]
    const engine = input.props.walletOutput?.engine
    if (engine != null) {
      for (const source of [engine.otherMethods, engine.otherMethodsWithKeys]) {
        if (source == null) continue
        for (const name of Object.keys(source)) {
          if (typeof source[name] === 'function') names.push(name)
        }
      }
    }
    const missing = names.filter(name => otherMethodStubs[name] == null)
    if (missing.length > 0) {
      const next: { [name: string]: (...args: any[]) => any } = {
        ...otherMethodStubs
      }
      for (const name of missing) {
        if (next[name] == null) next[name] = makeOtherMethodStub(name)
      }
      bridgifyObject(next)
      otherMethodStubs = next
    }
    return otherMethodStubs
  }

  const out: EdgeCurrencyWallet & InternalWalletMethods = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get created(): Date | undefined {
      return walletInfo.created
    },
    get disklet(): Disklet {
      return storageWalletApi.disklet
    },
    get id(): string {
      return storageWalletApi.id
    },
    get imported(): boolean {
      return walletInfo.imported === true
    },
    get localDisklet(): Disklet {
      return storageWalletApi.localDisklet
    },
    get publicWalletInfo(): EdgeWalletInfo {
      // The cache-loaded value may be upgraded (re-derived) later,
      // so always serve the latest one from Redux:
      return input.props.walletState.publicWalletInfo ?? publicWalletInfo
    },
    async sync(): Promise<void> {
      await getStorage()
      await storageWalletApi.sync()
    },
    get type(): string {
      return storageWalletApi.type
    },

    // Wallet name:
    get name(): string | null {
      return input.props.walletState.name
    },
    async renameWallet(name: string): Promise<void> {
      await getStorage()
      await renameCurrencyWallet(input, name)
    },

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      return input.props.walletState.fiat
    },
    async setFiatCurrencyCode(fiatCurrencyCode: string): Promise<void> {
      await getStorage()
      await setCurrencyWalletFiat(input, fiatCurrencyCode)
    },

    // Currency info:
    get currencyConfig(): EdgeCurrencyConfig {
      const { accountApi } = input.props.output.accounts[accountId]
      return accountApi.currencyConfig[pluginId]
    },
    get currencyInfo(): EdgeCurrencyInfo {
      return plugin.currencyInfo
    },
    async denominationToNative(
      denominatedAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        plugin.currencyInfo,
        input.props.state.accounts[accountId].allTokens[pluginId],
        currencyCode
      )
      return mul(denominatedAmount, multiplier)
    },
    async nativeToDenomination(
      nativeAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        plugin.currencyInfo,
        input.props.state.accounts[accountId].allTokens[pluginId],
        currencyCode
      )
      return div(nativeAmount, multiplier, multiplier.length)
    },

    // User settings for this wallet:
    get walletSettings(): JsonObject {
      return input.props.walletState.walletSettings
    },
    async changeWalletSettings(settings: JsonObject): Promise<void> {
      if (input.props.walletState.currencyInfo.hasWalletSettings !== true) {
        throw new Error('Wallet settings unsupported')
      }
      await getStorage()
      await saveWalletSettingsFile(input, settings)
    },

    // Chain state:
    get balances(): EdgeBalances {
      return input.props.walletState.balances
    },
    get balanceMap(): EdgeBalanceMap {
      return input.props.walletState.balanceMap
    },
    get blockHeight(): number {
      const { skipBlockHeight } = input.props.state
      return skipBlockHeight ? 0 : input.props.walletState.height
    },
    get syncRatio(): number {
      return input.props.walletState.syncStatus.totalRatio
    },
    get syncStatus(): EdgeSyncStatus {
      return input.props.walletState.syncStatus
    },
    get unactivatedTokenIds(): string[] {
      return input.props.walletState.unactivatedTokenIds
    },

    // Running state:
    async changePaused(paused: boolean): Promise<void> {
      // Un-pausing means the app wants this wallet running,
      // so align the startup queue with the caller's boot order:
      if (!paused) bumpEngineQueue(ai, walletId)

      input.props.dispatch({
        type: 'CURRENCY_WALLET_CHANGED_PAUSED',
        payload: { walletId: input.props.walletId, paused }
      })
    },
    get paused(): boolean {
      return input.props.walletState.paused
    },

    // Tokens:
    async changeEnabledTokenIds(tokenIds: string[]): Promise<void> {
      const { walletId, walletState } = input.props
      const { accountId, pluginId } = walletState

      // The caller built this list against the enabled list they
      // could see, so capture that baseline now. If an authoritative
      // load lands during the wait below, we re-apply the caller's
      // toggles to the fresh list instead of erasing it with a list
      // built from a stale one:
      const baseline = walletState.enabledTokenIds
      const added = uniqueStrings(tokenIds, baseline)
      const removed = baseline.filter(id => !tokenIds.includes(id))

      // The token file writer waits on `tokenFileLoaded`, which the
      // queued startup block sets, so a toggle on a cache-emitted
      // wallet would otherwise sit in Redux unwritten until this
      // wallet's turn comes up and be lost if the process dies first:
      bumpEngineQueue(ai, walletId)

      // On a warm login the builtin token definitions load after the
      // wallet exists; wait for them, or the filter below would
      // silently drop enabled builtin tokens. This must keep working
      // when the engine has failed, so only bail on deletion:
      const accountState = await ai.waitFor(props => {
        if (props.state.currency.wallets[walletId] == null) {
          throw new Error(
            `Wallet id ${walletId} does not exist in this account`
          )
        }
        const accountState = props.state.accounts[accountId]
        if (accountState?.builtinTokens[pluginId] != null) return accountState

        // A terminal boot failure means the definitions never arrive:
        if (accountState?.loadFailure != null) throw accountState.loadFailure
      })

      const { dispatch } = input.props
      const allTokens = accountState.allTokens[pluginId] ?? {}

      const enabledTokenIds = uniqueStrings(
        [...input.props.walletState.enabledTokenIds, ...added],
        removed
      ).filter(tokenId => allTokens[tokenId] != null)

      const shortId = walletId.slice(0, 2)
      input.props.log.warn(`enabledTokenIds: ${shortId} changeEnabledTokenIds`)
      dispatch({
        type: 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED',
        payload: { walletId, enabledTokenIds }
      })
    },

    get detectedTokenIds(): string[] {
      return input.props.walletState.detectedTokenIds
    },

    get enabledTokenIds(): string[] {
      return input.props.walletState.enabledTokenIds
    },

    // Transactions history:
    async getNumTransactions(opts: EdgeTokenIdOptions): Promise<number> {
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: opts.tokenId
      })
      return await countTxsInDatabase(
        input,
        walletDatabase(),
        upgradedCurrency.tokenId
      )
    },

    async $internalStreamTransactions(
      opts: EdgeStreamTransactionOptions
    ): Promise<InternalWalletStream> {
      const { tokenId = null } = opts
      const { currencyCode } =
        tokenId == null
          ? this.currencyInfo
          : this.currencyConfig.allTokens[tokenId]
      return streamTxsFromDatabase(input, walletDatabase(), {
        ...opts,
        currencyCode
      })
    },

    async getTransactions(
      opts: EdgeGetTransactionsOptions
    ): Promise<EdgeTransaction[]> {
      const {
        endDate: beforeDate,
        startDate: afterDate,
        searchString,
        spamThreshold
      } = opts
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: opts.tokenId
      })

      const stream = await out.$internalStreamTransactions({
        ...upgradedCurrency,
        afterDate,
        beforeDate,
        searchString,
        spamThreshold
      })

      // We have no length, so iterate to get everything:
      const txs: EdgeTransaction[] = []
      while (true) {
        const batch = await stream.next()
        if (batch.done) return txs
        txs.push(...batch.value)
      }
    },

    streamTransactions,

    // Addresses:
    async getAddresses(
      opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeAddress[]> {
      // Serve the cached answer while the engine is still loading, so
      // the receive scene works right away on a warm login. That
      // answer is whatever the engine last derived, which on a
      // rotating chain it may since have replaced, so the engine is
      // asked in the background and `addressChanged` fires if the two
      // disagree. A caller naming a specific index wants a freshly
      // derived address, which only the engine can produce, so that
      // query still waits. A wallet whose engine has FAILED also waits,
      // and therefore rejects: its engine is never coming, so serving
      // the cache forever would make a broken wallet indistinguishable
      // from a healthy one on this method alone:
      const cachedAddresses =
        input.props.walletState.addresses[opts.tokenId ?? ''] ?? []
      if (
        opts.forceIndex == null &&
        cachedAddresses.length > 0 &&
        input.props.walletState.engineFailure == null &&
        input.props.walletOutput?.engine == null
      ) {
        // The user is on an address screen, so they want this
        // wallet's engine sooner rather than later:
        bumpEngineQueue(ai, walletId)
        addressesServedFromCache.add(opts.tokenId ?? '')
        reconcileAddresses(opts)
        return cachedAddresses.map(address => ({ ...address }))
      }

      const engine = await getEngine()
      if (engine.getAddresses != null) {
        const addresses = await engine.getAddresses(opts)
        rememberAddresses(opts, addresses)
        return addresses
      } else {
        const upgradedCurrency = upgradeCurrencyCode({
          allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
          currencyInfo: plugin.currencyInfo,
          tokenId: opts.tokenId
        })

        const freshAddress = await engine.getFreshAddress({
          ...upgradedCurrency,
          forceIndex: opts.forceIndex
        })

        const {
          publicAddress,
          legacyAddress,
          segwitAddress,
          nativeBalance,
          legacyNativeBalance,
          segwitNativeBalance
        } = freshAddress

        const addresses: EdgeAddress[] = [
          {
            addressType: 'publicAddress',
            publicAddress,
            nativeBalance
          }
        ]

        if (segwitAddress != null) {
          addresses.unshift({
            addressType: 'segwitAddress',
            publicAddress: segwitAddress,
            nativeBalance: segwitNativeBalance
          })
        }

        if (legacyAddress != null) {
          addresses.push({
            addressType: 'legacyAddress',
            publicAddress: legacyAddress,
            nativeBalance: legacyNativeBalance
          })
        }

        rememberAddresses(opts, addresses)
        return addresses
      }
    },

    async getReceiveAddress(
      opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeReceiveAddress> {
      const addresses = await this.getAddresses(opts)
      if (addresses.length < 1) throw new Error('No addresses available')

      const primaryAddress =
        addresses.find(address => {
          return address.addressType === 'publicAddress'
        }) ?? addresses[0]

      const receiveAddress: EdgeReceiveAddress = {
        publicAddress: primaryAddress.publicAddress,
        nativeBalance: primaryAddress.nativeBalance,
        metadata: fakeMetadata,
        nativeAmount: '0'
      }

      const segwitAddress = addresses.find(address => {
        return address.addressType === 'segwitAddress'
      })
      if (segwitAddress != null) {
        receiveAddress.segwitAddress = segwitAddress.publicAddress
        receiveAddress.segwitNativeBalance = segwitAddress.nativeBalance
      }
      const legacyAddress = addresses.find(address => {
        return address.addressType === 'legacyAddress'
      })
      if (legacyAddress != null) {
        receiveAddress.legacyAddress = legacyAddress.publicAddress
        receiveAddress.legacyNativeBalance = legacyAddress.nativeBalance
      }

      return receiveAddress
    },
    async lockReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      // TODO: Address metadata
    },
    async saveReceiveAddress(
      receiveAddress: EdgeReceiveAddress
    ): Promise<void> {
      // TODO: Address metadata
    },

    // Sending:
    async broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      const engine = await getEngine()

      // Only provide wallet info if currency requires it:
      const privateKeys = unsafeBroadcastTx ? walletInfo.keys : undefined

      return await engine.broadcastTx(tx, { privateKeys })
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
      const engine = await getEngine()
      return await getMaxSpendableInner(
        spendInfo,
        plugin,
        engine,
        input.props.state.accounts[accountId].allTokens[pluginId],
        walletInfo
      )
    },
    async getPaymentProtocolInfo(
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      const engine = await getEngine()
      if (engine.getPaymentProtocolInfo == null) {
        throw new Error(
          "'getPaymentProtocolInfo' is not implemented on wallets of this type"
        )
      }
      return await engine.getPaymentProtocolInfo(paymentProtocolUrl)
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const engine = await getEngine()
      spendInfo = upgradeMemos(spendInfo, plugin.currencyInfo)
      const {
        assetAction,
        customNetworkFee,
        enableRbf,
        memos,
        metadata,
        networkFeeOption = 'standard',
        noUnconfirmed = false,
        otherParams,
        pendingTxs,
        rbfTxid,
        savedAction,
        skipChecks,
        spendTargets = [],
        swapData
      } = spendInfo

      // Figure out which asset this is:
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: spendInfo.tokenId
      })

      // Check the spend targets:
      const cleanTargets: EdgeSpendTarget[] = []
      const savedTargets: SavedSpendTargets = []
      for (const target of spendTargets) {
        const {
          memo,
          publicAddress,
          nativeAmount = '0',
          otherParams = {}
        } = target
        if (publicAddress == null) continue

        cleanTargets.push({
          memo,
          nativeAmount,
          otherParams,
          publicAddress,
          uniqueIdentifier: memo
        })
        savedTargets.push({
          currencyCode: upgradedCurrency.currencyCode,
          memo,
          nativeAmount,
          publicAddress,
          uniqueIdentifier: memo
        })
      }

      if (spendInfo.privateKeys != null) {
        throw new TypeError('Only sweepPrivateKeys takes private keys')
      }

      // Only provide wallet info if currency requires it:
      const privateKeys = unsafeMakeSpend ? walletInfo.keys : undefined

      const tx: EdgeTransaction = await engine.makeSpend(
        {
          ...upgradedCurrency,
          customNetworkFee,
          enableRbf,
          memos,
          metadata,
          networkFeeOption,
          noUnconfirmed,
          otherParams,
          pendingTxs,
          rbfTxid,
          skipChecks,
          spendTargets: cleanTargets
        },
        { privateKeys }
      )
      upgradeTxNetworkFees(tx)
      tx.networkFeeOption = networkFeeOption
      tx.requestedCustomFee = customNetworkFee
      tx.spendTargets = savedTargets
      tx.currencyCode = upgradedCurrency.currencyCode
      tx.tokenId = upgradedCurrency.tokenId
      if (metadata != null) tx.metadata = metadata
      if (swapData != null) tx.swapData = asEdgeTxSwap(swapData)
      if (savedAction != null) tx.savedAction = asEdgeTxAction(savedAction)
      if (assetAction != null) tx.assetAction = asEdgeAssetAction(assetAction)
      if (input.props.state.login.deviceInfo.deviceDescription != null)
        tx.deviceDescription =
          input.props.state.login.deviceInfo.deviceDescription

      return tx
    },
    async saveTx(transaction: EdgeTransaction): Promise<void> {
      const engine = await getEngine()
      if (input.props.walletState.txs[transaction.txid] == null) {
        const { fileName, txFile } = await setupNewTxMetadata(
          input,
          transaction
        )
        await saveTxMetadataFile(input, fileName, txFile)
        fakeCallbacks.onTransactions([{ isNew: true, transaction }])
      } else {
        await updateCurrencyWalletTxMetadata(
          input,
          transaction.txid,
          transaction.tokenId,
          fakeCallbacks
        )
      }
      await engine.saveTx(transaction)
    },

    async saveTxAction(opts): Promise<void> {
      await getEngine()
      const { txid, tokenId, assetAction, savedAction } = opts
      await updateCurrencyWalletTxMetadata(
        input,
        txid,
        tokenId,
        fakeCallbacks,
        undefined,
        assetAction,
        savedAction
      )
    },

    async saveTxMetadata(opts: EdgeSaveTxMetadataOptions): Promise<void> {
      await getEngine()
      const { txid, tokenId, metadata } = opts

      await updateCurrencyWalletTxMetadata(
        input,
        txid,
        tokenId,
        fakeCallbacks,
        metadata
      )
    },

    async signBytes(
      bytes: Uint8Array,
      opts: EdgeSignMessageOptions = {}
    ): Promise<string> {
      const engine = await getEngine()
      const privateKeys = walletInfo.keys

      if (engine.signBytes != null) {
        return await engine.signBytes(bytes, privateKeys, opts)
      }

      // Various plugins expect specific encodings for signing messages
      // (base16, base64, etc).
      // Do the conversion here temporarily if `signMessage` is implemented
      // while we migrate to `signBytes`.
      else if (pluginId === 'bitcoin' && engine.signMessage != null) {
        return await engine.signMessage(
          base64.stringify(bytes),
          privateKeys,
          opts
        )
      }

      throw new Error(`${pluginId} doesn't support signBytes`)
    },

    async signMessage(
      message: string,
      opts: EdgeSignMessageOptions = {}
    ): Promise<string> {
      const engine = await getEngine()
      if (engine.signMessage == null) {
        throw new Error(`${pluginId} doesn't support signing messages`)
      }
      const privateKeys = walletInfo.keys
      return await engine.signMessage(message, privateKeys, opts)
    },
    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      const engine = await getEngine()
      const privateKeys = walletInfo.keys

      return await engine.signTx(tx, privateKeys)
    },
    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const engine = await getEngine()
      if (engine.sweepPrivateKeys == null) {
        throw new Error('Sweeping this currency is not supported.')
      }
      return await engine.sweepPrivateKeys(spendInfo)
    },

    // Accelerating:
    async accelerate(tx: EdgeTransaction): Promise<EdgeTransaction | null> {
      const engine = await getEngine()
      if (engine.accelerate == null) return null
      return await engine.accelerate(tx)
    },

    // Staking:
    get stakingStatus(): EdgeStakingStatus {
      return input.props.walletState.stakingStatus
    },

    // Wallet management:
    async dumpData(): Promise<EdgeDataDump> {
      const engine = await getEngine()
      return await engine.dumpData()
    },
    async resyncBlockchain(): Promise<void> {
      const engine = await getEngine()
      const shortId = input.props.walletId.slice(0, 2)
      input.props.log.warn(`enabledTokenIds: ${shortId} resyncBlockchain`)
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.walletId }
      })
      await engine.resyncBlockchain()
      emit(out, 'transactionsRemoved', undefined)
    },

    async split(
      splitWallets: EdgeSplitCurrencyWallet[]
    ): Promise<Array<EdgeResult<EdgeCurrencyWallet>>> {
      return await splitWalletInfo(
        ai,
        accountId,
        walletInfo,
        splitWallets,
        false
      )
    },

    // URI handling:
    async encodeUri(options: EdgeEncodeUri): Promise<string> {
      const tools = await getTools()
      return await tools.encodeUri(
        options,
        makeMetaTokens(
          input.props.state.accounts[accountId].customTokens[pluginId]
        )
      )
    },
    async parseUri(uri: string, currencyCode?: string): Promise<EdgeParsedUri> {
      const tools = await getTools()
      const parsedUri = await tools.parseUri(
        uri,
        currencyCode,
        makeMetaTokens(
          input.props.state.accounts[accountId].customTokens[pluginId]
        )
      )

      if (parsedUri.tokenId === undefined) {
        const { tokenId = null } = upgradeCurrencyCode({
          allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
          currencyInfo: plugin.currencyInfo,
          currencyCode: parsedUri.currencyCode ?? currencyCode
        })
        parsedUri.tokenId = tokenId
      }
      return parsedUri
    },

    // Generic:
    get otherMethods(): EdgeOtherMethods {
      return syncOtherMethodStubs()
    }
  }

  return bridgifyObject(out)
}

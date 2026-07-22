import { abs, div, lt, mul } from 'biggystring'
import { Disklet } from 'disklet'
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
  EdgeTokenId,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo,
  JsonObject
} from '../../../types/types'
import { makeMetaTokens } from '../../account/custom-tokens'
import { splitWalletInfo } from '../../login/splitting'
import { asEdgeStorageKeys } from '../../login/storage-keys'
import { getCurrencyTools } from '../../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../../root-pixie'
import { makeLocalDisklet, makeRepoPaths } from '../../storage/repo'
import { makeStorageWalletApi } from '../../storage/storage-api'
import {
  bumpEngineQueue,
  checkCurrencyWallet,
  getCurrencyMultiplier,
  waitForCurrencyEngine
} from '../currency-selectors'
import {
  determineConfirmations,
  makeCurrencyWalletCallbacks,
  shouldCoreDetermineConfirmations
} from './currency-wallet-callbacks'
import {
  asEdgeAssetAction,
  asEdgeTxAction,
  asEdgeTxSwap,
  TransactionFile
} from './currency-wallet-cleaners'
import { dateFilter, searchStringFilter } from './currency-wallet-export'
import {
  loadTxFiles,
  renameCurrencyWallet,
  saveTxMetadataFile,
  saveWalletSettingsFile,
  setCurrencyWalletFiat,
  setupNewTxMetadata,
  updateCurrencyWalletTxMetadata
} from './currency-wallet-files'
import { CurrencyWalletInput } from './currency-wallet-pixie'
import { MergedTransaction } from './currency-wallet-reducer'
import { uniqueStrings } from './enabled-tokens'
import { getMaxSpendableInner } from './max-spend'
import { mergeMetadata } from './metadata'
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

  // The storage-wallet state provides the disklets once the repo loads,
  // but the wallet API can emit slightly earlier from the UI-state cache,
  // so lazily build the identical disklets as a synchronous fallback:
  let fallbackDisklets: { disklet: Disklet; localDisklet: Disklet } | undefined
  function getFallbackDisklets(): { disklet: Disklet; localDisklet: Disklet } {
    if (fallbackDisklets == null) {
      const { io } = ai.props
      const localDisklet = makeLocalDisklet(io, walletId)
      bridgifyObject(localDisklet)
      fallbackDisklets = {
        disklet: makeRepoPaths(io, asEdgeStorageKeys(walletInfo.keys)).disklet,
        localDisklet
      }
    }
    return fallbackDisklets
  }

  /**
   * Remembers the engine's answer to the default address query, so
   * the cache saver persists it and the next warm login can serve it
   * pre-engine on stable-address chains. Balances are stripped:
   * they are stale by definition and `balanceMap` already owns them.
   */
  function rememberAddresses(
    opts: EdgeGetReceiveAddressOptions,
    addresses: EdgeAddress[]
  ): void {
    if (opts.forceIndex != null) return
    input.props.dispatch({
      type: 'CURRENCY_WALLET_ADDRESSES_CHANGED',
      payload: {
        addresses: addresses.map(address => ({
          addressType: address.addressType,
          publicAddress: address.publicAddress
        })),
        walletId
      }
    })
  }

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  // The core guarantees `otherMethods` is `{}` (never `undefined`) before
  // the engine exists, so property probes stay safe on the GUI side.
  // Once the engine lands, the pixie watcher's `update` propagates the
  // engine's bridgified methods through the same getter:
  const emptyOtherMethods = bridgifyObject({})
  let engineOtherMethods: EdgeOtherMethods | undefined

  function makeEngineOtherMethods(
    engine: EdgeCurrencyEngine
  ): EdgeOtherMethods {
    const otherMethods: { [name: string]: (...args: any[]) => any } = {}
    if (engine.otherMethods != null) {
      for (const name of Object.keys(engine.otherMethods)) {
        const method = engine.otherMethods[name]
        if (typeof method !== 'function') continue
        otherMethods[name] = method
      }
    }
    if (engine.otherMethodsWithKeys != null) {
      for (const name of Object.keys(engine.otherMethodsWithKeys)) {
        const method = engine.otherMethodsWithKeys[name]
        if (typeof method !== 'function') continue
        otherMethods[name] = (...args) => method(walletInfo.keys, ...args)
      }
    }
    return bridgifyObject(otherMethods)
  }

  const out: EdgeCurrencyWallet & InternalWalletMethods = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get created(): Date | undefined {
      return walletInfo.created
    },
    get disklet(): Disklet {
      if (input.props.state.storageWallets[walletId] == null) {
        return getFallbackDisklets().disklet
      }
      return storageWalletApi.disklet
    },
    get id(): string {
      return storageWalletApi.id
    },
    get imported(): boolean {
      return walletInfo.imported === true
    },
    get localDisklet(): Disklet {
      if (input.props.state.storageWallets[walletId] == null) {
        return getFallbackDisklets().localDisklet
      }
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
      const engine = await getEngine()
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: opts.tokenId
      })

      return engine.getNumTransactions(upgradedCurrency)
    },

    async $internalStreamTransactions(
      opts: EdgeStreamTransactionOptions
    ): Promise<InternalWalletStream> {
      const engine = await getEngine()
      const {
        afterDate,
        batchSize = 10,
        beforeDate,
        firstBatchSize = batchSize,
        searchString,
        spamThreshold = '0',
        tokenId = null
      } = opts
      const { currencyCode } =
        tokenId == null
          ? this.currencyInfo
          : this.currencyConfig.allTokens[tokenId]
      const upgradedCurrency = { currencyCode, tokenId }

      // Load transactions from the engine if necessary:
      let state = input.props.walletState
      if (!state.gotTxs.has(tokenId)) {
        const txs = await engine.getTransactions(upgradedCurrency)
        fakeCallbacks.onTransactionsChanged(txs)
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_GOT_TXS',
          payload: {
            walletId: input.props.walletId,
            tokenId
          }
        })
        state = input.props.walletState
      }

      const {
        // All the files we have loaded from disk:
        files,
        // All the txid hashes we know about from either the engine or disk,
        // sorted using the lowest available date.
        // Some may not exist on disk, and some may not exist on chain:
        sortedTxidHashes,
        // Maps from txid hashes to original txids:
        txidHashes,
        // All the transactions we have from the engine:
        txs
      } = state

      let i = 0
      let isFirst = true
      let lastFile = 0
      return bridgifyObject({
        async next() {
          const thisBatchSize = isFirst ? firstBatchSize : batchSize
          const out: EdgeTransaction[] = []
          while (i < sortedTxidHashes.length && out.length < thisBatchSize) {
            // Load a batch of files if we need that:
            if (i >= lastFile) {
              const missingTxIdHashes = sortedTxidHashes
                .slice(lastFile, lastFile + thisBatchSize)
                .filter(txidHash => files[txidHash] == null)
              const missingFiles = await loadTxFiles(input, missingTxIdHashes)
              Object.assign(files, missingFiles)
              lastFile = lastFile + thisBatchSize
            }

            const txidHash = sortedTxidHashes[i++]
            const file = files[txidHash]
            const txid = file?.txid ?? txidHashes[txidHash]?.txid
            if (txid == null) continue
            const tx = txs[txid]

            // Filter transactions with missing amounts (nativeAmount/networkFee)
            const nativeAmount = tx?.nativeAmount.get(tokenId)
            const networkFee = tx?.networkFee.get(tokenId)
            if (tx == null || nativeAmount == null || networkFee == null) {
              continue
            }

            // Filter transactions based on search criteria:
            const edgeTx = combineTxWithFile(input, tx, file, tokenId)
            upgradeTxNetworkFees(edgeTx)
            if (!searchStringFilter(ai, edgeTx, searchString)) continue
            if (!dateFilter(edgeTx, afterDate, beforeDate)) continue
            const isKnown =
              tx.isSend ||
              edgeTx.assetAction != null ||
              edgeTx.chainAction != null ||
              edgeTx.chainAssetAction != null ||
              edgeTx.savedAction != null
            if (!isKnown && lt(abs(nativeAmount), spamThreshold)) continue

            out.push(edgeTx)
          }

          isFirst = false
          return { done: out.length === 0, value: out }
        }
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
      // On chains whose addresses never rotate, serve the cached
      // answer while the engine is still loading, so the receive
      // scene works right away on a warm login. Rotating chains
      // (and chains without the hint) wait for the engine, exactly
      // as before, to avoid address reuse:
      const { hasStableAddresses = false } = plugin.currencyInfo
      const cachedAddresses = input.props.walletState.addresses
      if (
        hasStableAddresses &&
        opts.forceIndex == null &&
        cachedAddresses.length > 0 &&
        input.props.walletOutput?.engine == null
      ) {
        // The user is on an address screen, so they want this
        // wallet's engine sooner rather than later:
        bumpEngineQueue(ai, walletId)
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
      const engine = input.props.walletOutput?.engine
      if (engine == null) return emptyOtherMethods
      if (engineOtherMethods == null) {
        engineOtherMethods = makeEngineOtherMethods(engine)
      }
      return engineOtherMethods
    }
  }

  return bridgifyObject(out)
}

export function combineTxWithFile(
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile | undefined,
  tokenId: EdgeTokenId,
  blockHeight?: number
): EdgeTransaction {
  const walletId = input.props.walletId
  const { accountId, currencyInfo, pluginId } = input.props.walletState
  const allTokens = input.props.state.accounts[accountId].allTokens[pluginId]

  const { currencyCode } = tokenId == null ? currencyInfo : allTokens[tokenId]
  const walletCurrency = currencyInfo.currencyCode

  // Use provided blockHeight or fall back to state (for callers outside onBlockHeightChanged):
  const height = blockHeight ?? input.props.walletState.height

  // Calculate confirmations on-the-fly if engine didn't provide valid value:
  const confirmations = shouldCoreDetermineConfirmations(tx.confirmations)
    ? determineConfirmations(tx, height, currencyInfo.requiredConfirmations)
    : tx.confirmations

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    chainAction: tx.chainAction,
    chainAssetAction: tx.chainAssetAction.get(tokenId),
    blockHeight: tx.blockHeight,
    confirmations,
    currencyCode,
    feeRateUsed: tx.feeRateUsed,
    date: tx.date,
    isSend: tx.isSend,
    memos: tx.memos,
    metadata: {},
    nativeAmount: tx.nativeAmount.get(tokenId) ?? '0',
    networkFee: tx.networkFee.get(tokenId) ?? '0',
    networkFees: [],
    otherParams: { ...tx.otherParams },
    ourReceiveAddresses: tx.ourReceiveAddresses,
    parentNetworkFee:
      walletCurrency === currencyCode
        ? undefined
        : tx.networkFee.get(null) ?? '0',
    signedTx: tx.signedTx,
    tokenId,
    txid: tx.txid,
    walletId
  }

  // If we have a file, use it to override the defaults:
  if (file != null) {
    if (file.creationDate < out.date) out.date = file.creationDate

    out.metadata = mergeMetadata(
      file.tokens.get(null)?.metadata ??
        file.currencies.get(walletCurrency)?.metadata ??
        {},
      file.tokens.get(tokenId)?.metadata ??
        file.currencies.get(currencyCode)?.metadata ??
        {}
    )

    if (file.feeRateRequested != null) {
      if (typeof file.feeRateRequested === 'string') {
        out.networkFeeOption = file.feeRateRequested
      } else {
        out.networkFeeOption = 'custom'
        out.requestedCustomFee = file.feeRateRequested
      }
    }
    if (out.feeRateUsed == null) {
      out.feeRateUsed = file.feeRateUsed
    }

    if (file.payees != null) {
      out.spendTargets = file.payees.map(payee => ({
        currencyCode: payee.currency,
        memo: payee.tag,
        nativeAmount: payee.amount,
        publicAddress: payee.address,
        uniqueIdentifier: payee.tag
      }))
    }

    const assetAction = file.tokens.get(tokenId)?.assetAction
    if (assetAction != null) out.assetAction = assetAction
    if (file.savedAction != null) out.savedAction = file.savedAction
    if (file.swap != null) out.swapData = file.swap
    if (file.secret != null) out.txSecret = file.secret
    if (file.deviceDescription != null)
      out.deviceDescription = file.deviceDescription
  }

  return out
}

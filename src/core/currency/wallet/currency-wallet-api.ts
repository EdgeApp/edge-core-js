import { add, div, lte, mul, sub } from 'biggystring'
import { Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import {
  InternalWalletMethods,
  InternalWalletStream,
  streamTransactions
} from '../../../client-side'
import { upgradeCurrencyCode } from '../../../types/type-helpers'
import {
  EdgeBalances,
  EdgeCurrencyCodeOptions,
  EdgeCurrencyConfig,
  EdgeCurrencyEngine,
  EdgeCurrencyInfo,
  EdgeCurrencyTools,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetReceiveAddressOptions,
  EdgeGetTransactionsOptions,
  EdgeMemoRules,
  EdgeMetadata,
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../../types/types'
import { mergeDeeply } from '../../../util/util'
import { makeMetaTokens } from '../../account/custom-tokens'
import { toApiInput } from '../../root-pixie'
import { makeStorageWalletApi } from '../../storage/storage-api'
import { getCurrencyMultiplier } from '../currency-selectors'
import { makeCurrencyWalletCallbacks } from './currency-wallet-callbacks'
import {
  asEdgeTxSwap,
  packMetadata,
  TransactionFile,
  unpackMetadata
} from './currency-wallet-cleaners'
import { dateFilter, searchStringFilter } from './currency-wallet-export'
import {
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from './currency-wallet-files'
import { CurrencyWalletInput } from './currency-wallet-pixie'
import { MergedTransaction } from './currency-wallet-reducer'
import { tokenIdsToCurrencyCodes, uniqueStrings } from './enabled-tokens'
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
  engine: EdgeCurrencyEngine,
  tools: EdgeCurrencyTools,
  publicWalletInfo: EdgeWalletInfo
): EdgeCurrencyWallet {
  const ai = toApiInput(input)
  const { accountId, pluginId, walletInfo } = input.props.walletState
  const plugin = input.props.state.plugins.currency[pluginId]
  const { unsafeBroadcastTx = false, unsafeMakeSpend = false } =
    plugin.currencyInfo

  const storageWalletApi = makeStorageWalletApi(ai, walletInfo)

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  let otherMethods = {}
  if (engine.otherMethods != null) {
    otherMethods = engine.otherMethods
    bridgifyObject(otherMethods)
  }

  const out: EdgeCurrencyWallet & InternalWalletMethods = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get disklet(): Disklet {
      return storageWalletApi.disklet
    },
    get id(): string {
      return storageWalletApi.id
    },
    get localDisklet(): Disklet {
      return storageWalletApi.localDisklet
    },
    publicWalletInfo,
    async sync(): Promise<void> {
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
      await renameCurrencyWallet(input, name)
    },

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      return input.props.walletState.fiat
    },
    async setFiatCurrencyCode(fiatCurrencyCode: string): Promise<void> {
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
      const plugin = input.props.state.plugins.currency[pluginId]
      const multiplier = getCurrencyMultiplier(
        plugin,
        input.props.state.accounts[accountId].allTokens[pluginId],
        currencyCode
      )
      return mul(denominatedAmount, multiplier)
    },
    async nativeToDenomination(
      nativeAmount: string,
      currencyCode: string
    ): Promise<string> {
      const plugin = input.props.state.plugins.currency[pluginId]
      const multiplier = getCurrencyMultiplier(
        plugin,
        input.props.state.accounts[accountId].allTokens[pluginId],
        currencyCode
      )
      return div(nativeAmount, multiplier, multiplier.length)
    },
    async validateMemo(memo: string): Promise<EdgeMemoRules> {
      if (tools.validateMemo == null) return { passed: true }
      return await tools.validateMemo(memo)
    },

    // Chain state:
    get balances(): EdgeBalances {
      return input.props.walletState.balances
    },
    get blockHeight(): number {
      const { skipBlockHeight } = input.props.state
      return skipBlockHeight ? 0 : input.props.walletState.height
    },
    get syncRatio(): number {
      return input.props.walletState.syncRatio
    },
    get unactivatedTokenIds(): string[] {
      return input.props.walletState.unactivatedTokenIds
    },

    // Running state:
    async changePaused(paused: boolean): Promise<void> {
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
      const { dispatch, state, walletId, walletState } = input.props
      const { builtinTokens, customTokens } = state.accounts[accountId]
      const { currencyInfo } = walletState

      dispatch({
        type: 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED',
        payload: {
          walletId,
          currencyCodes: uniqueStrings(
            tokenIdsToCurrencyCodes(
              builtinTokens[pluginId],
              customTokens[pluginId],
              currencyInfo,
              tokenIds
            )
          )
        }
      })
    },

    get enabledTokenIds(): string[] {
      return input.props.walletState.enabledTokenIds
    },

    // Transactions history:
    async getNumTransactions(
      opts: EdgeCurrencyCodeOptions = {}
    ): Promise<number> {
      return engine.getNumTransactions(opts)
    },

    async $internalStreamTransactions(
      opts: EdgeStreamTransactionOptions & { unfilteredStart?: number }
    ): Promise<InternalWalletStream> {
      const {
        afterDate,
        batchSize = 10,
        beforeDate,
        firstBatchSize = batchSize,
        searchString,
        tokenId,
        unfilteredStart
      } = opts
      const { currencyCode } =
        tokenId == null
          ? this.currencyInfo
          : this.currencyConfig.allTokens[tokenId]

      // Load transactions from the engine if necessary:
      let state = input.props.walletState
      if (!state.gotTxs[currencyCode]) {
        const txs = await engine.getTransactions({ currencyCode })
        fakeCallbacks.onTransactionsChanged(txs)
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_GOT_TXS',
          payload: {
            walletId: input.props.walletId,
            currencyCode
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

      let i = unfilteredStart ?? 0
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

            // Filter transactions based on the currency code:
            if (
              tx == null ||
              (tx.nativeAmount[currencyCode] == null &&
                tx.networkFee[currencyCode] == null)
            ) {
              continue
            }

            // Filter transactions based on search criteria:
            const edgeTx = combineTxWithFile(input, tx, file, currencyCode)
            if (!searchStringFilter(ai, edgeTx, searchString)) continue
            if (!dateFilter(edgeTx, afterDate, beforeDate)) continue

            // Preserve the `getTransactions` hack if needed:
            if (unfilteredStart != null) {
              edgeTx.otherParams = { ...edgeTx.otherParams, unfilteredIndex: i }
            }

            out.push(edgeTx)
          }

          isFirst = false
          return { done: out.length === 0, value: out }
        }
      })
    },

    async getTransactions(
      opts: EdgeGetTransactionsOptions = {}
    ): Promise<EdgeTransaction[]> {
      const {
        currencyCode = plugin.currencyInfo.currencyCode,
        endDate: beforeDate,
        startDate: afterDate,
        searchString,
        startEntries,
        startIndex = 0
      } = opts
      const { tokenId } = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        currencyCode
      })

      const stream = await out.$internalStreamTransactions({
        unfilteredStart: startIndex,
        batchSize: startEntries,
        afterDate,
        beforeDate,
        searchString,
        tokenId
      })

      // We have no length, so iterate to get everything:
      if (startEntries == null) {
        const out: EdgeTransaction[] = []
        while (true) {
          const batch = await stream.next()
          if (batch.done) return out
          out.push(...batch.value)
        }
      }

      // We have a length, so the first batch is all we need:
      const batch = await stream.next()
      return batch.value
    },

    streamTransactions,

    // Addresses:
    async getReceiveAddress(
      opts: EdgeGetReceiveAddressOptions = {}
    ): Promise<EdgeReceiveAddress> {
      const freshAddress = await engine.getFreshAddress(opts)
      const receiveAddress: EdgeReceiveAddress = {
        ...freshAddress,
        nativeAmount: '0',
        metadata: fakeMetadata
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
      // Only provide wallet info if currency requires it:
      const privateKeys = unsafeBroadcastTx ? walletInfo.keys : undefined

      return await engine.broadcastTx(tx, { privateKeys })
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
      spendInfo = upgradeMemos(spendInfo, plugin.currencyInfo)
      if (typeof engine.getMaxSpendable === 'function') {
        // Only provide wallet info if currency requires it:
        const privateKeys = unsafeMakeSpend ? walletInfo.keys : undefined

        return await engine.getMaxSpendable(spendInfo, { privateKeys })
      }
      const { currencyCode, networkFeeOption, customNetworkFee } = spendInfo
      const balance = engine.getBalance({ currencyCode })

      // Copy all the spend targets, setting the amounts to 0
      // but keeping all other information so we can get accurate fees:
      const spendTargets = spendInfo.spendTargets.map(spendTarget => {
        return { ...spendTarget, nativeAmount: '0' }
      })

      // The range of possible values includes `min`, but not `max`.
      function getMax(min: string, max: string): Promise<string> {
        const diff = sub(max, min)
        if (lte(diff, '1')) {
          return Promise.resolve(min)
        }
        const mid = add(min, div(diff, '2'))

        // Try the average:
        spendTargets[0].nativeAmount = mid

        // Only provide wallet info if currency requires it:
        const privateKeys = unsafeMakeSpend ? walletInfo.keys : undefined

        return engine
          .makeSpend(
            {
              currencyCode,
              spendTargets,
              networkFeeOption,
              customNetworkFee
            },
            { privateKeys }
          )
          .then(() => getMax(mid, max))
          .catch(() => getMax(min, mid))
      }

      return await getMax('0', add(balance, '1'))
    },
    async getPaymentProtocolInfo(
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      if (engine.getPaymentProtocolInfo == null) {
        throw new Error(
          "'getPaymentProtocolInfo' is not implemented on wallets of this type"
        )
      }
      return await engine.getPaymentProtocolInfo(paymentProtocolUrl)
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      spendInfo = upgradeMemos(spendInfo, plugin.currencyInfo)
      const {
        skipChecks,
        spendTargets = [],
        noUnconfirmed = false,
        networkFeeOption = 'standard',
        customNetworkFee,
        rbfTxid,
        metadata,
        swapData,
        otherParams,
        pendingTxs
      } = spendInfo

      // Figure out which asset this is:
      const { currencyCode, tokenId } = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        currencyCode: spendInfo.currencyCode,
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
          currencyCode,
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
          currencyCode,
          tokenId,
          skipChecks,
          spendTargets: cleanTargets,
          noUnconfirmed,
          networkFeeOption,
          customNetworkFee,
          rbfTxid,
          metadata,
          otherParams,
          pendingTxs
        },
        { privateKeys }
      )
      tx.networkFeeOption = networkFeeOption
      tx.requestedCustomFee = customNetworkFee
      tx.spendTargets = savedTargets
      if (metadata != null) tx.metadata = metadata
      if (swapData != null) tx.swapData = asEdgeTxSwap(swapData)
      if (input.props.state.login.deviceDescription != null)
        tx.deviceDescription = input.props.state.login.deviceDescription

      return tx
    },
    async saveTx(tx: EdgeTransaction): Promise<void> {
      await setupNewTxMetadata(input, tx)
      await engine.saveTx(tx)
      fakeCallbacks.onTransactionsChanged([tx])
    },
    async saveTxMetadata(
      txid: string,
      currencyCode: string,
      metadata: EdgeMetadata
    ): Promise<void> {
      await setCurrencyWalletTxMetadata(
        input,
        txid,
        currencyCode,
        packMetadata(metadata, input.props.walletState.fiat),
        fakeCallbacks
      )
    },
    async signMessage(
      message: string,
      opts: EdgeSignMessageOptions = {}
    ): Promise<string> {
      if (engine.signMessage == null) {
        throw new Error(`${pluginId} doesn't support signing messages`)
      }
      const privateKeys = walletInfo.keys
      return await engine.signMessage(message, privateKeys, opts)
    },
    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      const privateKeys = walletInfo.keys

      return await engine.signTx(tx, privateKeys)
    },
    async sweepPrivateKeys(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      if (engine.sweepPrivateKeys == null) {
        throw new Error('Sweeping this currency is not supported.')
      }
      return await engine.sweepPrivateKeys(spendInfo)
    },

    // Accelerating:
    async accelerate(tx: EdgeTransaction): Promise<EdgeTransaction | null> {
      if (engine.accelerate == null) return null
      return await engine.accelerate(tx)
    },

    // Staking:
    get stakingStatus(): EdgeStakingStatus {
      return input.props.walletState.stakingStatus
    },

    // Wallet management:
    async dumpData(): Promise<EdgeDataDump> {
      return await engine.dumpData()
    },
    async resyncBlockchain(): Promise<void> {
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.walletId }
      })
      await engine.resyncBlockchain()
    },

    // URI handling:
    async encodeUri(options: EdgeEncodeUri): Promise<string> {
      return await tools.encodeUri(
        options,
        makeMetaTokens(
          input.props.state.accounts[accountId].customTokens[pluginId]
        )
      )
    },
    async parseUri(uri: string, currencyCode?: string): Promise<EdgeParsedUri> {
      return await tools.parseUri(
        uri,
        currencyCode,
        makeMetaTokens(
          input.props.state.accounts[accountId].customTokens[pluginId]
        )
      )
    },

    // Generic:
    otherMethods
  }
  bridgifyObject(out)

  return out
}

export function combineTxWithFile(
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile | undefined,
  currencyCode: string
): EdgeTransaction {
  const walletId = input.props.walletId
  const walletCurrency = input.props.walletState.currencyInfo.currencyCode
  const walletFiat = input.props.walletState.fiat

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    blockHeight: tx.blockHeight,
    confirmations: tx.confirmations,
    currencyCode,
    date: tx.date,
    isSend: tx.isSend,
    memos: tx.memos,
    metadata: {},
    nativeAmount: tx.nativeAmount[currencyCode] ?? '0',
    networkFee: tx.networkFee[currencyCode] ?? '0',
    otherParams: { ...tx.otherParams },
    ourReceiveAddresses: tx.ourReceiveAddresses,
    parentNetworkFee: tx.networkFee[walletCurrency],
    signedTx: tx.signedTx,
    txid: tx.txid,
    walletId
  }

  // If we have a file, use it to override the defaults:
  if (file != null) {
    if (file.creationDate < out.date) out.date = file.creationDate

    const merged = mergeDeeply(
      file.currencies[walletCurrency],
      file.currencies[currencyCode]
    )
    if (merged.metadata != null) {
      out.metadata = {
        ...out.metadata,
        ...unpackMetadata(merged.metadata, walletFiat)
      }
    }

    if (file.feeRateRequested != null) {
      if (typeof file.feeRateRequested === 'string') {
        out.networkFeeOption = file.feeRateRequested
      } else {
        out.networkFeeOption = 'custom'
        out.requestedCustomFee = file.feeRateRequested
      }
    }
    out.feeRateUsed = file.feeRateUsed

    if (file.payees != null) {
      out.spendTargets = file.payees.map(payee => ({
        currencyCode: payee.currency,
        memo: payee.tag,
        nativeAmount: payee.amount,
        publicAddress: payee.address,
        uniqueIdentifier: payee.tag
      }))
    }

    if (file.swap != null) out.swapData = asEdgeTxSwap(file.swap)
    if (typeof file.secret === 'string') out.txSecret = file.secret
    if (file.deviceDescription != null)
      out.deviceDescription = file.deviceDescription
  }

  return out
}

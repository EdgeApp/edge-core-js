import { div, eq, mul } from 'biggystring'
import { Disklet } from 'disklet'
import { base64 } from 'rfc4648'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import {
  InternalWalletMethods,
  InternalWalletStream,
  streamTransactions
} from '../../../client-side'
import { upgradeCurrencyCode } from '../../../types/type-helpers'
import {
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
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeSaveTxMetadataOptions,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeTokenId,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../../types/types'
import { makeMetaTokens } from '../../account/custom-tokens'
import { toApiInput } from '../../root-pixie'
import { makeStorageWalletApi } from '../../storage/storage-api'
import { getCurrencyMultiplier } from '../currency-selectors'
import { makeCurrencyWalletCallbacks } from './currency-wallet-callbacks'
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
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
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
      const { dispatch, walletId, walletState } = input.props
      const { accountId, pluginId } = walletState
      const accountState = input.props.state.accounts[accountId]
      const allTokens = accountState.allTokens[pluginId] ?? {}

      const enabledTokenIds = uniqueStrings(tokenIds).filter(
        tokenId => allTokens[tokenId] != null
      )

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

      return engine.getNumTransactions(upgradedCurrency)
    },

    async $internalStreamTransactions(
      opts: EdgeStreamTransactionOptions
    ): Promise<InternalWalletStream> {
      const {
        afterDate,
        batchSize = 10,
        beforeDate,
        firstBatchSize = batchSize,
        searchString,
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

            // Filter transactions with zero amounts (nativeAmount/networkFee)
            const nativeAmount = tx?.nativeAmount.get(tokenId)
            const networkFee = tx?.networkFee.get(tokenId)
            if (
              tx == null ||
              nativeAmount == null ||
              (eq(nativeAmount, '0') && eq(networkFee ?? '0', '0'))
            ) {
              continue
            }

            // Filter transactions based on search criteria:
            const edgeTx = combineTxWithFile(input, tx, file, tokenId)
            if (!searchStringFilter(ai, edgeTx, searchString)) continue
            if (!dateFilter(edgeTx, afterDate, beforeDate)) continue

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
      const { endDate: beforeDate, startDate: afterDate, searchString } = opts
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: opts.tokenId
      })

      const stream = await out.$internalStreamTransactions({
        ...upgradedCurrency,
        afterDate,
        beforeDate,
        searchString
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
    async getReceiveAddress(
      opts: EdgeGetReceiveAddressOptions
    ): Promise<EdgeReceiveAddress> {
      const upgradedCurrency = upgradeCurrencyCode({
        allTokens: input.props.state.accounts[accountId].allTokens[pluginId],
        currencyInfo: plugin.currencyInfo,
        tokenId: opts.tokenId
      })

      const freshAddress = await engine.getFreshAddress({
        ...upgradedCurrency,
        forceIndex: opts.forceIndex
      })
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
      tx.networkFeeOption = networkFeeOption
      tx.requestedCustomFee = customNetworkFee
      tx.spendTargets = savedTargets
      tx.currencyCode = upgradedCurrency.currencyCode
      tx.tokenId = upgradedCurrency.tokenId
      if (metadata != null) tx.metadata = metadata
      if (swapData != null) tx.swapData = asEdgeTxSwap(swapData)
      if (savedAction != null) tx.savedAction = asEdgeTxAction(savedAction)
      if (assetAction != null) tx.assetAction = asEdgeAssetAction(assetAction)
      if (input.props.state.login.deviceDescription != null)
        tx.deviceDescription = input.props.state.login.deviceDescription

      return tx
    },
    async saveTx(tx: EdgeTransaction): Promise<void> {
      await setupNewTxMetadata(input, tx)
      await engine.saveTx(tx)
      fakeCallbacks.onTransactionsChanged([tx])
    },

    async saveTxAction(opts): Promise<void> {
      const { txid, tokenId, assetAction, savedAction } = opts
      await setCurrencyWalletTxMetadata(
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
      const { txid, tokenId, metadata } = opts

      await setCurrencyWalletTxMetadata(
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
    otherMethods
  }
  bridgifyObject(out)

  return out
}

export function combineTxWithFile(
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile | undefined,
  tokenId: EdgeTokenId
): EdgeTransaction {
  const walletId = input.props.walletId
  const { accountId, currencyInfo, pluginId } = input.props.walletState
  const allTokens = input.props.state.accounts[accountId].allTokens[pluginId]

  const { currencyCode } = tokenId == null ? currencyInfo : allTokens[tokenId]
  const walletCurrency = currencyInfo.currencyCode

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    chainAction: tx.chainAction,
    chainAssetAction: tx.chainAssetAction.get(tokenId),
    blockHeight: tx.blockHeight,
    confirmations: tx.confirmations,
    currencyCode,
    feeRateUsed: tx.feeRateUsed,
    date: tx.date,
    isSend: tx.isSend,
    memos: tx.memos,
    metadata: {},
    nativeAmount: tx.nativeAmount.get(tokenId) ?? '0',
    networkFee: tx.networkFee.get(tokenId) ?? '0',
    otherParams: { ...tx.otherParams },
    ourReceiveAddresses: tx.ourReceiveAddresses,
    parentNetworkFee: tx.networkFee.get(null) ?? '0',
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

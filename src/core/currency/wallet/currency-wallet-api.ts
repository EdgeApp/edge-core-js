import { add, div, lte, mul, sub } from 'biggystring'
import { Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

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
  const {
    unsafeBroadcastTx = false,
    unsafeMakeSpend = false
  } = plugin.currencyInfo

  const storageWalletApi = makeStorageWalletApi(ai, walletInfo)

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  let otherMethods = {}
  if (engine.otherMethods != null) {
    otherMethods = engine.otherMethods
    bridgifyObject(otherMethods)
  }

  const out: EdgeCurrencyWallet = {
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
      return input.props.walletState.height
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
    async getTransactions(
      opts: EdgeGetTransactionsOptions = {}
    ): Promise<EdgeTransaction[]> {
      const { currencyCode = plugin.currencyInfo.currencyCode } = opts

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
      const { startIndex = 0, startEntries = sortedTxidHashes.length } = opts

      // Iterate over the sorted transactions until we have enough output:
      const out: EdgeTransaction[] = []
      for (
        let i = startIndex, lastFile = startIndex;
        i < sortedTxidHashes.length && out.length < startEntries;
        ++i
      ) {
        // Load a batch of files if we need that:
        if (i >= lastFile) {
          const loadEnd = lastFile + startEntries
          const missingTxIdHashes = sortedTxidHashes
            .slice(lastFile, loadEnd)
            .filter(txidHash => files[txidHash] == null)
          const missingFiles = await loadTxFiles(input, missingTxIdHashes)
          Object.assign(files, missingFiles)
          lastFile = loadEnd
        }

        const txidHash = sortedTxidHashes[i]
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

        // add this tx / file to the output
        const edgeTx = combineTxWithFile(input, tx, file, currencyCode)
        if (searchStringFilter(ai, edgeTx, opts) && dateFilter(edgeTx, opts)) {
          out.push({
            ...edgeTx,
            otherParams: { ...edgeTx.otherParams, unfilteredIndex: i }
          })
        }
      }
      return out
    },

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

      return getMax('0', add(balance, '1'))
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
        const { publicAddress, nativeAmount = '0', otherParams = {} } = target
        if (publicAddress == null) continue

        // Handle legacy spenders:
        let { memo = target.uniqueIdentifier } = target
        if (memo == null && typeof otherParams.uniqueIdentifier === 'string') {
          memo = otherParams.uniqueIdentifier
        }

        // Support legacy currency plugins:
        if (memo != null) {
          otherParams.uniqueIdentifier = memo
        }

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
    metadata: {},
    isSend: tx.isSend,
    nativeAmount: tx.nativeAmount[currencyCode] ?? '0',
    networkFee: tx.networkFee[currencyCode] ?? '0',
    otherParams: { ...tx.otherParams },
    ourReceiveAddresses: tx.ourReceiveAddresses,
    parentNetworkFee: tx.networkFee[walletCurrency],
    signedTx: tx.signedTx,
    txid: tx.txid,
    walletId,

    // @ts-expect-error Deprecated & removed:
    amountSatoshi: Number(tx.nativeAmount[currencyCode] ?? '0')
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

// @flow

import { add, div, lte, mul, sub } from 'biggystring'

import type {
  EdgeBalances,
  EdgeCoinExchangeQuote,
  EdgeCurrencyCodeOptions,
  EdgeCurrencyEngine,
  EdgeCurrencyPlugin,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetTransactionsOptions,
  EdgeMetadata,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeTokenInfo,
  EdgeTransaction
} from '../../../edge-core-index.js'
import { SameCurrencyError } from '../../../error.js'
import { wrapObject } from '../../../util/api.js'
import { filterObject, mergeDeeply } from '../../../util/util.js'
import { makeShapeshiftApi } from '../../exchange/shapeshift.js'
import type { ShapeShiftExactQuoteReply } from '../../exchange/shapeshift.js'
import type { ApiInput } from '../../root.js'
import { makeStorageWalletApi } from '../../storage/storage-api.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import {
  exportTransactionsToCSVInner,
  exportTransactionsToQBOInner
} from './currency-wallet-export.js'
import {
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata
} from './currency-wallet-files.js'
import type { TransactionFile } from './currency-wallet-files.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'
import type { MergedTransaction } from './currency-wallet-reducer.js'

const fakeMetadata = {
  bizId: 0,
  category: '',
  exchangeAmount: {},
  name: '',
  notes: ''
}

/**
 * Creates an `EdgeCurrencyWallet` API object.
 */
export function makeCurrencyWalletApi (
  input: CurrencyWalletInput,
  plugin: EdgeCurrencyPlugin,
  engine: EdgeCurrencyEngine
) {
  const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
  const walletInfo = input.props.selfState.walletInfo

  const shapeshiftApi = makeShapeshiftApi(ai)
  const storageWalletApi = makeStorageWalletApi(ai, walletInfo, {})

  const out: EdgeCurrencyWallet = {
    // Storage wallet properties:
    get id () {
      return storageWalletApi.id
    },
    get type () {
      return storageWalletApi.type
    },
    get keys () {
      return storageWalletApi.keys
    },
    get folder () {
      return storageWalletApi.folder
    },
    get localFolder () {
      return storageWalletApi.localFolder
    },
    get displayPrivateSeed () {
      return input.props.selfState.displayPrivateSeed
    },
    get displayPublicSeed () {
      return input.props.selfState.displayPublicSeed
    },
    sync () {
      return storageWalletApi.sync()
    },

    // Storage stuff:
    get name () {
      return input.props.selfState.name
    },
    renameWallet (name: string) {
      return renameCurrencyWallet(input, name).then(() => {})
    },

    // Currency info:
    get fiatCurrencyCode (): string {
      return input.props.selfState.fiat
    },
    get currencyInfo () {
      return plugin.currencyInfo
    },
    setFiatCurrencyCode (fiatCurrencyCode: string) {
      return setCurrencyWalletFiat(input, fiatCurrencyCode).then(() => {})
    },

    // Chain state:
    get balances (): EdgeBalances {
      return input.props.selfState.balances
    },

    get blockHeight (): number {
      return input.props.selfState.height
    },

    // Running state:
    startEngine () {
      return engine.startEngine()
    },

    stopEngine (): Promise<mixed> {
      return Promise.resolve(engine.killEngine())
    },

    enableTokens (tokens: Array<string>) {
      return engine.enableTokens(tokens)
    },

    disableTokens (tokens: Array<string>) {
      return engine.disableTokens(tokens)
    },

    getEnabledTokens () {
      return engine.getEnabledTokens()
    },

    addCustomToken (tokenInfo: EdgeTokenInfo) {
      ai.props.dispatch({ type: 'ADDED_CUSTOM_TOKEN', payload: tokenInfo })
      return engine.addCustomToken(tokenInfo)
    },

    // Transactions:
    getNumTransactions (opts: EdgeCurrencyCodeOptions = {}) {
      return Promise.resolve(engine.getNumTransactions(opts))
    },

    async getTransactions (
      opts: EdgeGetTransactionsOptions = {}
    ): Promise<Array<EdgeTransaction>> {
      const defaultCurrency = plugin.currencyInfo.currencyCode
      const currencyCode = opts.currencyCode || defaultCurrency
      const state = input.props.selfState
      // Txid array of all txs
      const txids = state.txids
      // Merged tx data from metadata files and blockchain data
      const txs = state.txs
      const { startIndex = 0, startEntries = txids.length } = opts
      // Decrypted metadata files
      const files = state.files
      // A sorted list of transaction based on chronological order
      const sortedTransactions = state.sortedTransactions.sortedList
      // Quick fix for Tokens
      const allInfos = input.props.state.currency.infos
      let slice = false
      for (const currencyInfo of allInfos) {
        if (currencyCode === currencyInfo.currencyCode) {
          slice = true
          break
        }
      }
      const slicedTransactions = slice
        ? sortedTransactions.slice(startIndex, startIndex + startEntries)
        : sortedTransactions
      const missingTxIdHashes = slicedTransactions.filter(
        txidHash => !files[txidHash]
      )
      const missingFiles = await loadTxFiles(input, missingTxIdHashes)
      Object.assign(files, missingFiles)

      const out: Array<EdgeTransaction> = []
      for (const txidHash of slicedTransactions) {
        const file = files[txidHash]
        const tx = txs[file.txid]
        // Skip irrelevant transactions:
        if (
          !tx ||
          (!tx.nativeAmount[currencyCode] && !tx.networkFee[currencyCode])
        ) {
          continue
        }

        out.push(combineTxWithFile(input, tx, file, currencyCode))
      }

      return out
    },

    async exportTransactionsToQBO (
      opts: EdgeGetTransactionsOptions
    ): Promise<string> {
      const edgeTransactions: Array<
        EdgeTransaction
      > = await this.getTransactions(opts)
      const currencyCode =
        opts && opts.currencyCode
          ? opts.currencyCode
          : input.props.selfState.currencyInfo.currencyCode
      const denom = opts && opts.denomination ? opts.denomination : null
      const qbo: string = exportTransactionsToQBOInner(
        edgeTransactions,
        currencyCode,
        this.fiatCurrencyCode,
        denom,
        Date.now()
      )
      return qbo
    },

    async exportTransactionsToCSV (
      opts: EdgeGetTransactionsOptions
    ): Promise<string> {
      const edgeTransactions: Array<
        EdgeTransaction
      > = await this.getTransactions(opts)
      const currencyCode =
        opts && opts.currencyCode
          ? opts.currencyCode
          : input.props.selfState.currencyInfo.currencyCode
      const denom = opts && opts.denomination ? opts.denomination : null
      const csv: string = await exportTransactionsToCSVInner(
        edgeTransactions,
        currencyCode,
        this.fiatCurrencyCode,
        denom
      )
      return csv
    },

    getReceiveAddress (
      opts: EdgeCurrencyCodeOptions = {}
    ): Promise<EdgeReceiveAddress> {
      const freshAddress = engine.getFreshAddress(opts)
      const receiveAddress: EdgeReceiveAddress = {
        metadata: fakeMetadata,
        nativeAmount: '0',
        publicAddress: freshAddress.publicAddress,
        legacyAddress: freshAddress.legacyAddress,
        segwitAddress: freshAddress.segwitAddress
      }
      return Promise.resolve(receiveAddress)
    },

    saveReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<mixed> {
      return Promise.resolve()
    },

    lockReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<mixed> {
      return Promise.resolve()
    },

    async makeSpend (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return engine.makeSpend(spendInfo)
    },

    async sweepPrivateKeys (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      if (!engine.sweepPrivateKeys) {
        return Promise.reject(
          new Error('Sweeping this currency is not supported.')
        )
      }
      return engine.sweepPrivateKeys(spendInfo)
    },

    async getQuote (spendInfo: EdgeSpendInfo): Promise<EdgeCoinExchangeQuote> {
      const destWallet = spendInfo.spendTargets[0].destWallet
      if (!destWallet) {
        throw new SameCurrencyError()
      }
      const currentCurrencyCode = spendInfo.currencyCode
        ? spendInfo.currencyCode
        : plugin.currencyInfo.currencyCode
      const destCurrencyCode = spendInfo.spendTargets[0].currencyCode
        ? spendInfo.spendTargets[0].currencyCode
        : destWallet.currencyInfo.currencyCode
      if (destCurrencyCode === currentCurrencyCode) {
        throw new SameCurrencyError()
      }
      const edgeFreshAddress = engine.getFreshAddress({
        currencyCode: destCurrencyCode
      })
      const edgeReceiveAddress = await destWallet.getReceiveAddress()

      let destPublicAddress
      if (edgeReceiveAddress.legacyAddress) {
        destPublicAddress = edgeReceiveAddress.legacyAddress
      } else {
        destPublicAddress = edgeReceiveAddress.publicAddress
      }

      let currentPublicAddress
      if (edgeFreshAddress.legacyAddress) {
        currentPublicAddress = edgeFreshAddress.legacyAddress
      } else {
        currentPublicAddress = edgeFreshAddress.publicAddress
      }

      const nativeAmount = spendInfo.nativeAmount
      const quoteFor = spendInfo.quoteFor
      if (!quoteFor) {
        throw new Error('Need to define direction for quoteFor')
      }
      const destAmount = spendInfo.spendTargets[0].nativeAmount
      /* console.log('core: destAmount', destAmount) */
      // here we are going to get multipliers
      const currencyInfos = ai.props.state.currency.infos
      const tokenInfos = ai.props.state.currency.customTokens
      const multiplierFrom = getCurrencyMultiplier(
        currencyInfos,
        tokenInfos,
        currentCurrencyCode
      )
      const multiplierTo = getCurrencyMultiplier(
        currencyInfos,
        tokenInfos,
        destCurrencyCode
      )

      /* if (destAmount) {
        nativeAmount = destAmount
      } */
      if (!nativeAmount) {
        throw new Error('Need to define a native amount')
      }
      const nativeAmountForQuote = destAmount || nativeAmount

      const quoteData: ShapeShiftExactQuoteReply = await shapeshiftApi.getexactQuote(
        currentCurrencyCode,
        destCurrencyCode,
        currentPublicAddress,
        destPublicAddress,
        nativeAmountForQuote,
        quoteFor,
        multiplierFrom,
        multiplierTo
      )
      if (!quoteData.success) {
        throw new Error('Did not get back successful quote')
      }
      const exchangeData = quoteData.success
      const nativeAmountForSpend = destAmount
        ? mul(exchangeData.depositAmount, multiplierFrom)
        : nativeAmount

      const hasDestTag = exchangeData.deposit.indexOf('?dt=') !== -1
      let destTag
      if (hasDestTag) {
        const splitArray = exchangeData.deposit.split('?dt=')
        exchangeData.deposit = splitArray[0]
        destTag = splitArray[1]
      }

      const spendTarget: EdgeSpendTarget = {
        nativeAmount: nativeAmountForSpend,
        publicAddress: exchangeData.deposit
      }
      if (hasDestTag) {
        spendTarget.otherParams = {
          uniqueIdentifier: destTag
        }
      }
      if (currentCurrencyCode === 'XMR' && exchangeData.sAddress) {
        const paymentId = exchangeData.deposit
        spendTarget.publicAddress = exchangeData.sAddress
        spendTarget.otherParams = {
          uniqueIdentifier: paymentId
        }
      }

      const exchangeSpendInfo: EdgeSpendInfo = {
        // networkFeeOption: spendInfo.networkFeeOption,
        currencyCode: spendInfo.currencyCode,
        spendTargets: [spendTarget]
      }
      const tx = await engine.makeSpend(exchangeSpendInfo)
      tx.otherParams = tx.otherParams || {}
      tx.otherParams.exchangeData = exchangeData
      const edgeCoinExchangeQuote: EdgeCoinExchangeQuote = {
        depositAmountNative: mul(exchangeData.depositAmount, multiplierFrom),
        withdrawalAmountNative: mul(
          exchangeData.withdrawalAmount,
          multiplierTo
        ),
        expiration: exchangeData.expiration,
        quotedRate: exchangeData.quotedRate,
        maxLimit: exchangeData.maxLimit,
        orderId: exchangeData.orderId,
        edgeTransacton: tx
      }
      return edgeCoinExchangeQuote
    },

    signTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.signTx(tx)
    },

    broadcastTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.broadcastTx(tx)
    },

    saveTx (tx: EdgeTransaction) {
      return engine.saveTx(tx)
    },

    resyncBlockchain (): Promise<mixed> {
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.id }
      })
      return Promise.resolve(engine.resyncBlockchain())
    },

    dumpData (): Promise<EdgeDataDump> {
      return Promise.resolve(engine.dumpData())
    },

    getPaymentProtocolInfo (
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      if (!engine.getPaymentProtocolInfo) {
        throw new Error(
          "'getPaymentProtocolInfo' is not implemented on wallets of this type"
        )
      }
      return engine.getPaymentProtocolInfo(paymentProtocolUrl)
    },

    saveTxMetadata (txid: string, currencyCode: string, metadata: EdgeMetadata) {
      return setCurrencyWalletTxMetadata(
        input,
        txid,
        currencyCode,
        fixMetadata(metadata, input.props.selfState.fiat)
      )
    },

    getMaxSpendable (spendInfo: EdgeSpendInfo): Promise<string> {
      const { currencyCode, networkFeeOption, customNetworkFee } = spendInfo
      const balance = engine.getBalance({ currencyCode })

      // Copy all the spend targets, setting the amounts to 0
      // but keeping all other information so we can get accurate fees:
      const spendTargets = spendInfo.spendTargets.map(spendTarget => {
        if (
          spendTarget.currencyCode &&
          spendTarget.currencyCode !== currencyCode
        ) {
          throw new Error('Cannot to a cross-currency max-spend')
        }
        return { ...spendTarget, nativeAmount: '0' }
      })

      // The range of possible values includes `min`, but not `max`.
      function getMax (min: string, max: string): Promise<string> {
        const diff = sub(max, min)
        if (lte(diff, '1')) {
          return Promise.resolve(min)
        }
        const mid = add(min, div(diff, '2'))

        // Try the average:
        spendTargets[0].nativeAmount = mid
        return engine
          .makeSpend({
            currencyCode,
            spendTargets,
            networkFeeOption,
            customNetworkFee
          })
          .then(good => getMax(mid, max))
          .catch(bad => getMax(min, mid))
      }

      return getMax('0', add(balance, '1'))
    },

    parseUri (uri: string) {
      return Promise.resolve(plugin.parseUri(uri))
    },

    encodeUri (obj: EdgeEncodeUri) {
      return Promise.resolve(plugin.encodeUri(obj))
    },

    // Deprecated API's:
    '@getBalance': { sync: true },
    getBalance (opts: EdgeCurrencyCodeOptions = {}) {
      return engine.getBalance(opts)
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine.getBlockHeight()
    },

    '@getDisplayPrivateSeed': { sync: true },
    getDisplayPrivateSeed (): string | null {
      return engine.getDisplayPrivateSeed()
    },

    '@getDisplayPublicSeed': { sync: true },
    getDisplayPublicSeed (): string | null {
      return engine.getDisplayPublicSeed()
    }
  }

  return wrapObject('CurrencyWallet', out)
}

function fixMetadata (metadata: EdgeMetadata, fiat: string) {
  const out = filterObject(metadata, [
    'bizId',
    'category',
    'exchangeAmount',
    'name',
    'notes'
  ])

  if (metadata.amountFiat != null) {
    if (out.exchangeAmount == null) out.exchangeAmount = {}
    out.exchangeAmount[fiat] = metadata.amountFiat
  }

  return out
}

export function combineTxWithFile (
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile,
  currencyCode: string
): EdgeTransaction {
  const wallet = input.props.selfOutput.api
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,

    amountSatoshi: Number(tx.nativeAmount[currencyCode]),
    nativeAmount: tx.nativeAmount[currencyCode],
    networkFee: tx.networkFee[currencyCode],
    currencyCode,
    wallet,

    otherParams: {}
  }

  // These are our fallback values:
  const fallback = {
    providerFeeSent: 0,
    metadata: {
      name: '',
      category: '',
      notes: '',
      bizId: 0,
      amountFiat: 0,
      exchangeAmount: {}
    }
  }

  const merged = file
    ? mergeDeeply(
      fallback,
      file.currencies[walletCurrency],
      file.currencies[currencyCode]
    )
    : fallback

  if (file && file.creationDate < out.date) out.date = file.creationDate
  out.metadata = merged.metadata
  if (
    merged.metadata &&
    merged.metadata.exchangeAmount &&
    merged.metadata.exchangeAmount[walletFiat]
  ) {
    out.metadata.amountFiat = merged.metadata.exchangeAmount[walletFiat]
    if (out.metadata && out.metadata.amountFiat.toString().includes('e')) {
      // Corrupt amountFiat that exceeds a number that JS can cleanly represent without exponents. Set to 0
      out.metadata.amountFiat = 0
    }
  } else {
    console.info('Missing amountFiat in combineTxWithFile')
  }

  return out
}

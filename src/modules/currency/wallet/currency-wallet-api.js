// @flow

import { abs, add, div, lt, lte, mul, sub } from 'biggystring'
import jsoncsv from 'json-csv'
import ofx from 'ofx'

import type {
  EdgeCoinExchangeQuote,
  EdgeCurrencyEngine,
  EdgeCurrencyPlugin,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetTransactionsOptions,
  EdgeMetadata,
  EdgeReceiveAddress,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeTokenInfo,
  EdgeTransaction
} from '../../../edge-core-index.js'
import { SameCurrencyError } from '../../../error.js'
import { wrapObject } from '../../../util/api.js'
import { filterObject, mergeDeeply } from '../../../util/util.js'
import { getCurrencyMultiplier } from '../../currency/currency-selectors'
import { makeShapeshiftApi } from '../../exchange/shapeshift.js'
import type { ShapeShiftExactQuoteReply } from '../../exchange/shapeshift.js'
import type { ApiInput } from '../../root.js'
import { makeStorageWalletApi } from '../../storage/storageApi.js'
import {
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata
} from './currency-wallet-files.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'

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
    sync () {
      return storageWalletApi.sync()
    },

    // Storage stuff:
    get name () {
      return input.props.selfState.name
    },
    renameWallet (name: string) {
      return renameCurrencyWallet(input, name)
    },

    // Currency info:
    get fiatCurrencyCode (): string {
      return input.props.selfState.fiat
    },
    get currencyInfo () {
      return plugin.currencyInfo
    },
    setFiatCurrencyCode (fiatCurrencyCode: string) {
      return setCurrencyWalletFiat(input, fiatCurrencyCode)
    },

    // Running state:
    startEngine () {
      return engine.startEngine()
    },

    stopEngine (): Promise<void> {
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
    '@getBalance': { sync: true },
    getBalance (opts: any) {
      return engine.getBalance(opts)
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine.getBlockHeight()
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

      const out = []
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
        opts && opts.currencyCode ? opts.currencyCode : this.currencyCode
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
        opts && opts.currencyCode ? opts.currencyCode : this.currencyCode
      const denom = opts && opts.denomination ? opts.denomination : null
      const csv: string = await exportTransactionsToCSVInner(
        edgeTransactions,
        currencyCode,
        this.fiatCurrencyCode,
        denom
      )
      return csv
    },

    getReceiveAddress (opts: any): Promise<EdgeReceiveAddress> {
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

    saveReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<void> {
      return Promise.resolve()
    },

    lockReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<void> {
      return Promise.resolve()
    },

    '@makeAddressQrCode': { sync: true },
    makeAddressQrCode (address: EdgeReceiveAddress) {
      return address.publicAddress
    },

    '@makeAddressUri': { sync: true },
    makeAddressUri (address: EdgeReceiveAddress) {
      return address.publicAddress
    },

    async makeSpend (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return engine.makeSpend(spendInfo)
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
      const edgeFreshAddress = engine.getFreshAddress()
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

      const spendTarget: EdgeSpendTarget = {
        nativeAmount: nativeAmountForSpend,
        publicAddress: exchangeData.deposit
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

    resyncBlockchain (): Promise<void> {
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.id }
      })
      return Promise.resolve(engine.resyncBlockchain())
    },

    '@dumpData': { sync: true },
    dumpData (): EdgeDataDump {
      return engine.dumpData()
    },

    '@getDisplayPrivateSeed': { sync: true },
    getDisplayPrivateSeed (): string | null {
      return engine.getDisplayPrivateSeed()
    },

    '@getDisplayPublicSeed': { sync: true },
    getDisplayPublicSeed (): string | null {
      return engine.getDisplayPublicSeed()
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

    sweepPrivateKey (keyUri: string): Promise<void> {
      return Promise.resolve()
    },

    '@parseUri': { sync: true },
    parseUri (uri: string) {
      return plugin.parseUri(uri)
    },

    '@encodeUri': { sync: true },
    encodeUri (obj: EdgeEncodeUri) {
      return plugin.encodeUri(obj)
    }
  }

  return wrapObject('CurrencyWallet', out)
}

function fixMetadata (metadata: EdgeMetadata, fiat: any) {
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
  tx: any,
  file: any,
  currencyCode: string
) {
  const wallet = input.props.selfOutput.api
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  // Copy the tx properties to the output:
  const out = {
    ...tx,
    amountSatoshi: Number(tx.nativeAmount[currencyCode]),
    nativeAmount: tx.nativeAmount[currencyCode],
    networkFee: tx.networkFee[currencyCode],
    currencyCode,
    wallet
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
  out.providerFee = merged.providerFeeSent
  out.metadata = merged.metadata
  if (
    merged.metadata &&
    merged.metadata.exchangeAmount &&
    merged.metadata.exchangeAmount[walletFiat]
  ) {
    out.metadata.amountFiat = merged.metadata.exchangeAmount[walletFiat]
    if (out.metadata.amountFiat.toString().includes('e')) {
      // Corrupt amountFiat that exceeds a number that JS can cleanly represent without exponents. Set to 0
      out.metadata.amountFiat = 0
    }
  } else {
    console.info('Missing amountFiat in combineTxWithFile')
  }

  return out
}

function makeOfxDate (date: number): string {
  const d = new Date(date * 1000)
  const yyyy = d.getUTCFullYear().toString()
  const mm = padZero((d.getUTCMonth() + 1).toString())
  const dd = padZero(d.getUTCDate().toString())
  const hh = padZero(d.getUTCHours().toString())
  const min = padZero(d.getUTCMinutes().toString())
  const ss = padZero(d.getUTCSeconds().toString())
  return `${yyyy}${mm}${dd}${hh}${min}${ss}.000`
}

function padZero (val: string) {
  if (val.length === 1) {
    return '0' + val
  }
  return val
}
function makeCsvDateTime (date: number): { date: string, time: string } {
  const d = new Date(date * 1000)
  const yyyy = d.getUTCFullYear().toString()
  const mm = padZero((d.getUTCMonth() + 1).toString())
  const dd = padZero(d.getUTCDate().toString())
  const hh = padZero(d.getUTCHours().toString())
  const min = padZero(d.getUTCMinutes().toString())

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`
  }
}
export function exportTransactionsToQBOInner (
  edgeTransactions: Array<EdgeTransaction>,
  currencyCode: string,
  fiatCurrencyCode: string,
  denom: number | null,
  dateNow: number
): string {
  const STMTTRN = []
  const now = makeOfxDate(dateNow / 1000)

  for (const edgeTx: EdgeTransaction of edgeTransactions) {
    const TRNAMT: string = denom
      ? div(edgeTx.nativeAmount, denom.toString(), 18)
      : edgeTx.nativeAmount
    const TRNTYPE = lt(edgeTx.nativeAmount, '0') ? 'DEBIT' : 'CREDIT'
    const DTPOSTED = makeOfxDate(edgeTx.date)
    let NAME: string = ''
    let amountFiat: number = 0
    let category: string = ''
    let notes: string = ''
    if (edgeTx.metadata) {
      NAME = edgeTx.metadata.name ? edgeTx.metadata.name : ''
      amountFiat = edgeTx.metadata.amountFiat ? edgeTx.metadata.amountFiat : 0
      category = edgeTx.metadata.category ? edgeTx.metadata.category : ''
      notes = edgeTx.metadata.notes ? edgeTx.metadata.notes : ''
    }
    const absFiat = abs(amountFiat.toString())
    const absAmount = abs(TRNAMT)
    const CURRATE = absAmount !== '0' ? div(absFiat, absAmount, 8) : '0'
    const MEMO = `// Rate=${CURRATE} ${fiatCurrencyCode}=${amountFiat} category="${category}" memo="${notes}"`

    const qboTx = {
      TRNTYPE,
      DTPOSTED,
      TRNAMT,
      FITID: edgeTx.txid,
      NAME,
      MEMO,
      CURRENCY: {
        CURRATE: '',
        CURSYM: fiatCurrencyCode
      }
    }
    STMTTRN.push(qboTx)
  }

  const header = {
    OFXHEADER: '100',
    DATA: 'OFXSGML',
    VERSION: '102',
    SECURITY: 'NONE',
    ENCODING: 'USASCII',
    CHARSET: '1252',
    COMPRESSION: 'NONE',
    OLDFILEUID: 'NONE',
    NEWFILEUID: 'NONE'
  }

  const body = {
    SIGNONMSGSRSV1: {
      SONRS: {
        STATUS: {
          CODE: '0',
          SEVERITY: 'INFO'
        },
        DTSERVER: now,
        LANGUAGE: 'ENG',
        'INTU.BID': '3000'
      }
    },
    BANKMSGSRSV1: {
      STMTTRNRS: {
        TRNUID: now,
        STATUS: {
          CODE: '0',
          SEVERITY: 'INFO',
          MESSAGE: 'OK'
        },
        STMTRS: {
          CURDEF: 'USD',
          BANKACCTFROM: {
            BANKID: '999999999',
            ACCTID: '999999999999',
            ACCTTYPE: 'CHECKING'
          },
          BANKTRANLIST: {
            DTSTART: now,
            DTEND: now,
            STMTTRN
          },
          LEDGERBAL: {
            BALAMT: '0.00',
            DTASOF: now
          },
          AVAILBAL: {
            BALAMT: '0.00',
            DTASOF: now
          }
        }
      }
    }
  }

  return ofx.serialize(header, body)
}

export async function exportTransactionsToCSVInner (
  edgeTransactions: Array<EdgeTransaction>,
  currencyCode: string,
  fiatCurrencyCode: string,
  denom: number | null
): Promise<string> {
  return new Promise((resolve, reject) => {
    const currencyField = 'AMT_' + currencyCode
    const networkFeeField = 'AMT_NETWORK_FEES_' + currencyCode
    const items = []

    for (const edgeTx: EdgeTransaction of edgeTransactions) {
      const amount: string = denom
        ? div(edgeTx.nativeAmount, denom.toString(), 18)
        : edgeTx.nativeAmount
      const networkFeeField: string = denom
        ? div(edgeTx.networkFee, denom.toString(), 18)
        : edgeTx.networkFee
      const { date, time } = makeCsvDateTime(edgeTx.date)
      let name: string = ''
      let amountFiat: number = 0
      let category: string = ''
      let notes: string = ''
      if (edgeTx.metadata) {
        name = edgeTx.metadata.name ? edgeTx.metadata.name : ''
        amountFiat = edgeTx.metadata.amountFiat ? edgeTx.metadata.amountFiat : 0
        category = edgeTx.metadata.category ? edgeTx.metadata.category : ''
        notes = edgeTx.metadata.notes ? edgeTx.metadata.notes : ''
      }

      const csvTx = {
        date,
        time,
        name,
        amount,
        amountFiat,
        category,
        notes,
        networkFeeField,
        txid: edgeTx.txid,
        ourReceiveAddresses: edgeTx.ourReceiveAddresses,
        version: 1
      }
      items.push(csvTx)
    }

    const options = {
      fields: [
        {
          name: 'date',
          label: 'DATE',
          quoted: true
        },
        {
          name: 'time',
          label: 'TIME',
          quoted: true
        },
        {
          name: 'name',
          label: 'PAYEE_PAYER_NAME',
          quoted: true
        },
        {
          name: 'amount',
          label: currencyField,
          quoted: true
        },
        {
          name: 'amountFiat',
          label: fiatCurrencyCode,
          quoted: true
        },
        {
          name: 'category',
          label: 'CATEGORY',
          quoted: true
        },
        {
          name: 'notes',
          label: 'NOTES',
          quoted: true
        },
        {
          name: 'networkFeeField',
          label: networkFeeField,
          quoted: true
        },
        {
          name: 'txid',
          label: 'TXID',
          quoted: true
        },
        {
          name: 'ourReceiveAddresses',
          label: 'OUR_RECEIVE_ADDRESSES',
          quoted: true
        },
        {
          name: 'version',
          label: 'VER'
        }
      ]
    }

    jsoncsv.csvBuffered(items, options, (err, csv) => {
      if (err) {
        reject(err)
      } else {
        resolve(csv)
      }
    })
  })
}

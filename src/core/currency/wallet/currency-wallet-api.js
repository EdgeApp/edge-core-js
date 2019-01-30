// @flow

import { add, div, lte, mul, sub } from 'biggystring'
import { type Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { CurrencyWalletSync } from '../../../client-side.js'
import {
  type EdgeBalances,
  type EdgeCurrencyCodeOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyWallet,
  type EdgeDataDump,
  type EdgeEncodeUri,
  type EdgeGetTransactionsOptions,
  type EdgeMetadata,
  type EdgeParsedUri,
  type EdgePaymentProtocolInfo,
  type EdgeReceiveAddress,
  type EdgeSpendInfo,
  type EdgeTokenInfo,
  type EdgeTransaction
} from '../../../types/types.js'
import { filterObject, mergeDeeply } from '../../../util/util.js'
import { getCurrencyTools } from '../../plugins/plugins-selectors.js'
import { type ApiInput } from '../../root-pixie.js'
import { makeStorageWalletApi } from '../../storage/storage-api.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import { makeCurrencyWalletCallbacks } from './currency-wallet-callbacks.js'
import {
  exportTransactionsToCSVInner,
  exportTransactionsToQBOInner
} from './currency-wallet-export.js'
import {
  type TransactionFile,
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata
} from './currency-wallet-files.js'
import { type CurrencyWalletInput } from './currency-wallet-pixie.js'
import { type MergedTransaction } from './currency-wallet-reducer.js'

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
  const { walletInfo, pluginName } = input.props.selfState

  const storageWalletApi = makeStorageWalletApi(ai, walletInfo)

  const fakeCallbacks = makeCurrencyWalletCallbacks(input)

  let otherMethods = {}
  if (engine.otherMethods != null) {
    otherMethods = engine.otherMethods
    bridgifyObject(otherMethods)
  }

  function lockdown () {
    if (ai.props.state.hideKeys) {
      throw new Error('Not available when `hideKeys` is enabled')
    }
  }

  const out: EdgeCurrencyWallet = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get id (): string {
      return storageWalletApi.id
    },
    get type (): string {
      return storageWalletApi.type
    },
    get keys (): Object {
      lockdown()
      return storageWalletApi.keys
    },
    get disklet (): Disklet {
      return storageWalletApi.disklet
    },
    get localDisklet (): Disklet {
      return storageWalletApi.localDisklet
    },
    async sync (): Promise<mixed> {
      return storageWalletApi.sync()
    },

    // Wallet keys:
    get displayPrivateSeed (): string | null {
      lockdown()
      return input.props.selfState.displayPrivateSeed
    },
    get displayPublicSeed (): string | null {
      return input.props.selfState.displayPublicSeed
    },

    // Wallet name:
    get name (): string | null {
      return input.props.selfState.name
    },
    async renameWallet (name: string): Promise<mixed> {
      return renameCurrencyWallet(input, name).then(() => {})
    },

    // Currency info:
    get currencyInfo (): EdgeCurrencyInfo {
      return plugin.currencyInfo
    },
    async nativeToDenomination (
      nativeAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        input.props.state.currency.infos,
        input.props.state.currency.customTokens,
        currencyCode
      )
      return div(nativeAmount, multiplier, multiplier.length)
    },
    async denominationToNative (
      denominatedAmount: string,
      currencyCode: string
    ): Promise<string> {
      const multiplier = getCurrencyMultiplier(
        input.props.state.currency.infos,
        input.props.state.currency.customTokens,
        currencyCode
      )
      return mul(denominatedAmount, multiplier)
    },

    // Fiat currency option:
    get fiatCurrencyCode (): string {
      return input.props.selfState.fiat
    },
    async setFiatCurrencyCode (fiatCurrencyCode: string): Promise<mixed> {
      return setCurrencyWalletFiat(input, fiatCurrencyCode).then(() => {})
    },

    // Chain state:
    get balances (): EdgeBalances {
      return input.props.selfState.balances
    },

    get blockHeight (): number {
      return input.props.selfState.height
    },

    get syncRatio (): number {
      return input.props.selfState.syncRatio
    },

    // Running state:
    async startEngine (): Promise<mixed> {
      return engine.startEngine()
    },

    async stopEngine (): Promise<mixed> {
      return engine.killEngine()
    },

    // Tokens:
    async enableTokens (tokens: Array<string>): Promise<mixed> {
      return engine.enableTokens(tokens)
    },

    async disableTokens (tokens: Array<string>): Promise<mixed> {
      return engine.disableTokens(tokens)
    },

    async getEnabledTokens (): Promise<Array<string>> {
      return engine.getEnabledTokens()
    },

    async addCustomToken (tokenInfo: EdgeTokenInfo): Promise<mixed> {
      ai.props.dispatch({ type: 'ADDED_CUSTOM_TOKEN', payload: tokenInfo })
      return engine.addCustomToken(tokenInfo)
    },

    // Transactions:
    async getNumTransactions (
      opts: EdgeCurrencyCodeOptions = {}
    ): Promise<number> {
      return engine.getNumTransactions(opts)
    },

    async getTransactions (
      opts: EdgeGetTransactionsOptions = {}
    ): Promise<Array<EdgeTransaction>> {
      const defaultCurrency = plugin.currencyInfo.currencyCode
      const currencyCode = opts.currencyCode || defaultCurrency

      let state = input.props.selfState
      if (!state.gotTxs[currencyCode]) {
        const txs = await engine.getTransactions({
          currencyCode: opts.currencyCode
        })
        fakeCallbacks.onTransactionsChanged(txs)
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_GOT_TXS',
          payload: {
            walletId: input.props.id,
            currencyCode
          }
        })
        state = input.props.selfState
      }

      // Txid array of all txs
      const txids = state.txids
      // Merged tx data from metadata files and blockchain data
      const txs = state.txs
      const { startIndex = 0, startEntries = txids.length } = opts
      // Decrypted metadata files
      const files = state.files
      // A sorted list of transaction based on chronological order
      const sortedTransactions = state.sortedTransactions.sortedList

      // we need to make sure that after slicing, the total txs number is equal to opts.startEntries
      // slice, verify txs in files, if some are dropped and missing, do it again recursively
      const getBulkTx = async (index: number, out: any = []) => {
        if (out.length === startEntries || index >= sortedTransactions.length) {
          return out
        }
        const entriesLeft = startEntries - out.length
        const slicedTransactions = sortedTransactions.slice(
          index,
          index + entriesLeft
        )
        const missingTxIdHashes = slicedTransactions.filter(
          txidHash => !files[txidHash]
        )
        // load files into state
        const missingFiles = await loadTxFiles(input, missingTxIdHashes)
        Object.assign(files, missingFiles)

        for (const txidHash of slicedTransactions) {
          const file = files[txidHash]
          const tx = txs[file.txid]
          // skip irrelevant transactions - txs that are not in the files (dropped)
          if (
            !tx ||
            (!tx.nativeAmount[currencyCode] && !tx.networkFee[currencyCode])
          ) {
            continue
          }
          out.push(combineTxWithFile(input, tx, file, currencyCode))
        }
        // continue until the required tx number loaded
        const res = await getBulkTx(index + entriesLeft, out)
        return res
      }

      const out: Array<EdgeTransaction> = await getBulkTx(startIndex)
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

    async getReceiveAddress (
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
      return receiveAddress
    },

    async saveReceiveAddress (
      receiveAddress: EdgeReceiveAddress
    ): Promise<mixed> {
      // TODO: Address metadata
    },

    async lockReceiveAddress (
      receiveAddress: EdgeReceiveAddress
    ): Promise<mixed> {
      // TODO: Address metadata
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

    async signTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.signTx(tx)
    },

    async broadcastTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
      return engine.broadcastTx(tx)
    },

    async saveTx (tx: EdgeTransaction): Promise<mixed> {
      return engine.saveTx(tx)
    },

    async resyncBlockchain (): Promise<mixed> {
      ai.props.dispatch({
        type: 'CURRENCY_ENGINE_CLEARED',
        payload: { walletId: input.props.id }
      })
      return engine.resyncBlockchain()
    },

    async dumpData (): Promise<EdgeDataDump> {
      return engine.dumpData()
    },

    async getPaymentProtocolInfo (
      paymentProtocolUrl: string
    ): Promise<EdgePaymentProtocolInfo> {
      if (!engine.getPaymentProtocolInfo) {
        throw new Error(
          "'getPaymentProtocolInfo' is not implemented on wallets of this type"
        )
      }
      return engine.getPaymentProtocolInfo(paymentProtocolUrl)
    },

    async saveTxMetadata (
      txid: string,
      currencyCode: string,
      metadata: EdgeMetadata
    ): Promise<mixed> {
      return setCurrencyWalletTxMetadata(
        input,
        txid,
        currencyCode,
        fixMetadata(metadata, input.props.selfState.fiat),
        fakeCallbacks
      )
    },

    async getMaxSpendable (spendInfo: EdgeSpendInfo): Promise<string> {
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

    async parseUri (uri: string): Promise<EdgeParsedUri> {
      const tools = await getCurrencyTools(ai, pluginName)
      return tools.parseUri(uri)
    },

    async encodeUri (obj: EdgeEncodeUri): Promise<string> {
      const tools = await getCurrencyTools(ai, pluginName)
      return tools.encodeUri(obj)
    },

    otherMethods,

    // Deprecated API's:
    getBalance: CurrencyWalletSync.prototype.getBalance,
    getBlockHeight: CurrencyWalletSync.prototype.getBlockHeight,
    getDisplayPrivateSeed: CurrencyWalletSync.prototype.getDisplayPrivateSeed,
    getDisplayPublicSeed: CurrencyWalletSync.prototype.getDisplayPublicSeed
  }
  bridgifyObject(out)

  return out
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
    input.props.io.console.info('Missing amountFiat in combineTxWithFile')
  }

  return out
}

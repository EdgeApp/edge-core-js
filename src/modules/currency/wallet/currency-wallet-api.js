// @flow

import { add, div, lte, sub } from 'biggystring'

import type {
  EdgeCurrencyEngine,
  EdgeCurrencyPlugin,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeMetadata,
  EdgeReceiveAddress,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeTokenInfo,
  EdgeTransaction
} from '../../../edge-core-index.js'
import { wrapObject } from '../../../util/api.js'
import { filterObject, mergeDeeply } from '../../../util/util.js'
import { makeShapeshiftApi } from '../../exchange/shapeshift.js'
import type { ApiInput } from '../../root.js'
import { makeStorageWalletApi } from '../../storage/storageApi.js'
import {
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

    getTransactions (opts: any = {}): Promise<Array<EdgeTransaction>> {
      const files = input.props.selfState.files
      const txids = input.props.selfState.txids
      const txs = input.props.selfState.txs
      const defaultCurrency = plugin.currencyInfo.currencyCode
      const currencyCode = opts.currencyCode || defaultCurrency

      const out = []
      for (const txid of txids) {
        const tx = txs[txid]
        const file = files[txid]

        // Skip irrelevant transactions:
        if (!tx.nativeAmount[currencyCode] && !tx.networkFee[currencyCode]) {
          continue
        }

        out.push(combineTxWithFile(input, tx, file, currencyCode))
      }

      // TODO: Handle the sort within the tx list merge process:
      return Promise.resolve(out.sort((a, b) => a.date - b.date))
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
      if (spendInfo.spendTargets[0].destWallet) {
        const destWallet = spendInfo.spendTargets[0].destWallet
        const currentCurrencyCode = spendInfo.currencyCode
          ? spendInfo.currencyCode
          : plugin.currencyInfo.currencyCode
        const destCurrencyCode = spendInfo.spendTargets[0].currencyCode
          ? spendInfo.spendTargets[0].currencyCode
          : destWallet.currencyInfo.currencyCode
        if (destCurrencyCode !== currentCurrencyCode) {
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
          const exchangeData = await shapeshiftApi.getSwapAddress(
            currentCurrencyCode,
            destCurrencyCode,
            currentPublicAddress,
            destPublicAddress
          )

          let nativeAmount = spendInfo.nativeAmount
          const destAmount = spendInfo.spendTargets[0].nativeAmount

          if (destAmount) {
            const rate = await shapeshiftApi.getExchangeSwapRate(
              currentCurrencyCode,
              destCurrencyCode
            )
            nativeAmount = div(destAmount, rate.toString())
          }

          const spendTarget: EdgeSpendTarget = {
            nativeAmount: nativeAmount,
            publicAddress: exchangeData.deposit
          }

          const exchangeSpendInfo: EdgeSpendInfo = {
            networkFeeOption: spendInfo.networkFeeOption,
            currencyCode: spendInfo.currencyCode,
            spendTargets: [spendTarget]
          }

          const tx = await engine.makeSpend(exchangeSpendInfo)

          tx.otherParams = tx.otherParams || {}
          tx.otherParams.exchangeData = exchangeData
          return tx
        }
        // transfer same currency from one wallet to another
      }

      return engine.makeSpend(spendInfo)
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
  } else {
    console.info('Missing amountFiat in combineTxWithFile')
  }

  return out
}

import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { makeCurrencyState } from './currencyState.js'

const fakeMetadata = {
  payeeName: '',
  category: '',
  notes: '',
  amountFiat: 0,
  bizId: 0
}

/**
 * Creates a `CurrencyWallet` API object.
 */
export function makeCurrencyWallet (keyInfo, opts) {
  const { io } = opts
  return makeCurrencyState(keyInfo, opts).then(state =>
    wrapObject(io.console, 'CurrencyWallet', makeCurrencyApi(state))
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeCurrencyApi (state) {
  const { storage, engine, plugin } = state

  const out = {
    // Storage stuff:
    get name () {
      return state.name
    },
    renameWallet (name) {
      return state.rename(name)
    },

    // Currency info:
    get fiatCurrencyCode () {
      return 'USD'
    },
    get currencyInfo () {
      return plugin.getInfo()
    },

    // Running state:
    startEngine () {
      return engine.startEngine()
    },

    stopEngine () {
      return engine.killEngine()
    },

    // Transactions:
    '@getBalance': { sync: true },
    getBalance (currencyCode) {
      return engine.getBalance({ currencyCode })
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine.getBlockHeight()
    },

    getTransactions (opts = {}) {
      return engine.getTransactions(opts)
    },

    getReceiveAddress (opts) {
      return Promise.resolve({
        publicAddress: engine.getFreshAddress(opts),
        amountSatoshi: 0,
        metadata: fakeMetadata
      })
    },

    saveReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    lockReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    '@makeAddressQrCode': { sync: true },
    makeAddressQrCode (address) {
      return address.publicAddress
    },

    '@makeAddressUri': { sync: true },
    makeAddressUri (address) {
      return address.publicAddress
    },

    makeSpend (spendInfo) {
      return engine.makeSpend(spendInfo)
    },

    signTx (tx) {
      return engine.signTx(tx)
    },

    broadcastTx (tx) {
      return engine.broadcastTx(tx)
    },

    saveTx (tx) {
      return engine.saveTx(tx)
    },

    getMaxSpendable (spendInfo) {
      return Promise.resolve(0)
    },

    sweepPrivateKey (keyUri) {
      return Promise.resolve(0)
    }
  }
  copyProperties(out, makeStorageWalletApi(storage))

  return out
}

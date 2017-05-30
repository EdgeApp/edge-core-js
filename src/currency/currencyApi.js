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
  const { storage } = state

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

    // Transactions:
    '@getBalance': { sync: true },
    getBalance (currencyCode) {
      return 0
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return 0
    },

    getTransactions (opts = {}) {
      return Promise.resolve([])
    },

    getReceiveAddress (opts) {
      return Promise.resolve({
        publicAddress: 'foobar',
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
      return ''
    },

    '@makeAddressUri': { sync: true },
    makeAddressUri (address) {
      return ''
    },

    makeSpend (spendInfo) {
      return Promise.resolve({})
    },

    signTx (tx) {
      return Promise.resolve(tx)
    },

    broadcastTx (tx) {
      return Promise.resolve(tx)
    },

    saveTx (tx) {
      return Promise.resolve(tx)
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

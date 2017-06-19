import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { derive, makeReaction } from '../util/derive.js'
import { addCurrencyWallet, renameCurrencyWallet } from './actions.js'
import { getCurrencyWalletName } from './selectors.js'

function nop () {}

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
  const { io, callbacks = {} } = opts
  const { redux: { dispatch, getState } } = io
  const state = derive(() => getState().currencyWallets)
  return dispatch(
    addCurrencyWallet(state, keyInfo, opts)
  ).then(currencyWallet =>
    wrapObject(
      io.onError,
      'CurrencyWallet',
      makeCurrencyApi(dispatch, currencyWallet, callbacks)
    )
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeCurrencyApi (dispatch, currencyWallet, callbacks) {
  const name = derive(() => getCurrencyWalletName(currencyWallet()))
  const engine = derive(() => currencyWallet().engine)
  const plugin = derive(() => currencyWallet().plugin)

  const {
    // onAddressesChecked = nop,
    // onBalanceChanged = nop,
    // onBlockHeightChanged = nop,
    // onDataChanged = nop,
    // onNewTransactions = nop,
    // onTransactionsChanged = nop,
    onWalletNameChanged = nop
  } = callbacks

  makeReaction(() => onWalletNameChanged(name()))

  const out = {
    // Storage stuff:
    get name () {
      return name()
    },
    renameWallet (name) {
      return dispatch(renameCurrencyWallet(currencyWallet, name))
    },

    // Currency info:
    get fiatCurrencyCode () {
      return 'USD'
    },
    get currencyInfo () {
      return plugin().getInfo()
    },

    // Running state:
    startEngine () {
      return engine().startEngine()
    },

    stopEngine () {
      return Promise.resolve(engine().killEngine())
    },

    // Transactions:
    '@getBalance': { sync: true },
    getBalance (currencyCode) {
      return engine().getBalance({ currencyCode })
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine().getBlockHeight()
    },

    getTransactions (opts = {}) {
      return engine().getTransactions(opts)
    },

    getReceiveAddress (opts) {
      return Promise.resolve({
        publicAddress: engine().getFreshAddress(opts),
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
      return engine().makeSpend(spendInfo)
    },

    signTx (tx) {
      return engine().signTx(tx)
    },

    broadcastTx (tx) {
      return engine().broadcastTx(tx)
    },

    saveTx (tx) {
      return engine().saveTx(tx)
    },

    getMaxSpendable (spendInfo) {
      return Promise.resolve(0)
    },

    sweepPrivateKey (keyUri) {
      return Promise.resolve(0)
    }
  }
  copyProperties(out, makeStorageWalletApi(currencyWallet().storage))

  return out
}

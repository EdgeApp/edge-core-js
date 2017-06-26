import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { derive, makeReaction } from '../util/derive.js'
import { filterObject } from '../util/util.js'
import {
  addCurrencyWallet,
  renameCurrencyWallet,
  setCurrencyWalletTxMetadata
} from './actions.js'
import { compareTxs, mergeTxs } from './functions.js'
import {
  getCurrencyWalletEngine,
  getCurrencyWalletFiles,
  getCurrencyWalletName,
  getCurrencyWalletPlugin,
  getCurrencyWalletTxs,
  getStorageWallet
} from './selectors.js'

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
  const { redux } = io

  return redux
    .dispatch(addCurrencyWallet(keyInfo, opts))
    .then(keyId =>
      wrapObject(
        io.onError,
        'CurrencyWallet',
        makeCurrencyApi(redux, keyId, callbacks)
      )
    )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeCurrencyApi (redux, keyId, callbacks) {
  const { dispatch, getState } = redux
  const files = derive(() => getCurrencyWalletFiles(getState(), keyId))
  const name = derive(() => getCurrencyWalletName(getState(), keyId))
  const engine = derive(() => getCurrencyWalletEngine(getState(), keyId))
  const plugin = derive(() => getCurrencyWalletPlugin(getState(), keyId))
  const txs = derive(() => getCurrencyWalletTxs(getState(), keyId))

  const mergedTxs = derive(() => mergeTxs(txs(), files()))

  const {
    // onAddressesChecked = nop,
    // onBalanceChanged = nop,
    // onBlockHeightChanged = nop,
    // onDataChanged = nop,
    // onNewTransactions = nop,
    onTransactionsChanged = nop,
    onWalletNameChanged = nop
  } = callbacks

  // Hook up the `onWalletNameChanged` callback:
  makeReaction(() => onWalletNameChanged(name()))

  // Hook up the `onTransactionsChanged` and `onNewTransactions` callbacks:
  let oldTxs
  makeReaction(() => {
    const newTxs = mergedTxs()
    const { changes } = compareTxs(oldTxs, newTxs)
    oldTxs = newTxs
    if (changes.length) onTransactionsChanged(changes)
  })

  const out = {
    // Storage stuff:
    get name () {
      return name()
    },
    renameWallet (name) {
      return dispatch(renameCurrencyWallet(keyId, name))
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
      const txs = mergedTxs()
      return Promise.resolve(Object.keys(txs).map(key => txs[key]))
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
      return Promise.all([
        engine().saveTx(tx),
        dispatch(
          setCurrencyWalletTxMetadata(
            keyId,
            tx.txid,
            filterObject(tx, ['metadata', 'txid', 'amountSatoshi'])
          )
        )
      ])
    },

    getMaxSpendable (spendInfo) {
      return Promise.resolve(0)
    },

    sweepPrivateKey (keyUri) {
      return Promise.resolve(0)
    }
  }
  copyProperties(out, makeStorageWalletApi(getStorageWallet(getState(), keyId)))

  return out
}

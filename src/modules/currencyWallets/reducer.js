import { combineReducers } from 'redux'
import { recycle } from '../../util/compare.js'
import {
  constReducer,
  listReducer,
  settableReducer
} from '../../util/redux/reducers.js'

// Basic wallet list:
const ADD = 'airbitz-core-js/currencyWallet/ADD'
const UPDATE = 'airbitz-core-js/currencyWallet/UPDATE'
const SET_ENGINE = 'airbitz-core-js/currencyWallet/engine/SET'

export function add (keyId, initialState) {
  return { type: ADD, payload: { id: keyId, initialState } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { id: keyId, action } }
}

export function setEngine (keyId, engine) {
  return update(keyId, { type: SET_ENGINE, payload: engine })
}

// Wallet settable data:
const SET_BALANCE = 'airbitz-core-js/currencyWallet/balance/SET'
const SET_BLOCK_HEIGHT = 'airbitz-core-js/currencyWallet/blockHeight/SET'
const SET_FIAT = 'airbitz-core-js/currencyWallet/fiat/SET'
const SET_NAME = 'airbitz-core-js/currencyWallet/name/SET'
const SET_PROGRESS = 'airbitz-core-js/currencyWallet/progress/SET'

export function setBalance (keyId, balance) {
  return update(keyId, { type: SET_BALANCE, payload: balance })
}

export function setBlockHeight (keyId, blockHeight) {
  return update(keyId, { type: SET_BLOCK_HEIGHT, payload: blockHeight })
}

export function setFiat (keyId, currencyCode) {
  return update(keyId, { type: SET_FIAT, payload: currencyCode })
}

export function setName (keyId, name) {
  return update(keyId, { type: SET_NAME, payload: name })
}

export function setProgress (keyId, progress) {
  return update(keyId, { type: SET_PROGRESS, payload: progress })
}

// Transactions list:
const ADD_TXS = 'airbitz-core-js/currencyWallet/transactions/UPDATE'
const SET_FILE = 'airbitz-core-js/currencyWallet/transactions/SET_FILE'
const SET_FILES = 'airbitz-core-js/currencyWallet/transactions/SET_FILES'

export function addTxs (keyId, txs, defaultCurrency) {
  return update(keyId, { type: ADD_TXS, payload: { txs, defaultCurrency } })
}

export function setFile (keyId, txid, json) {
  return update(keyId, { type: SET_FILE, payload: { txid, json } })
}

export function setFiles (keyId, files) {
  return update(keyId, { type: SET_FILES, payload: { files } })
}

/**
 * Merges a new incoming transaction with an existing transaction.
 */
function mergeTx (tx, defaultCurrency, oldTx = {}) {
  const out = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,

    nativeAmount: { ...oldTx.nativeAmount },
    networkFee: { ...oldTx.networkFee },
    providerFee: { ...oldTx.providerFee }
  }

  const currencyCode =
    tx.currencyCode != null ? tx.currencyCode : defaultCurrency
  out.nativeAmount[currencyCode] =
    tx.amountSatoshi != null ? tx.amountSatoshi.toString() : tx.nativeAmount
  out.networkFee[currencyCode] =
    tx.networkFee != null ? tx.networkFee.toString() : '0'
  out.providerFee[currencyCode] =
    tx.providerFee != null ? tx.providerFee.toString() : '0'

  return out
}

function files (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case SET_FILE: {
      const { txid, json } = payload
      const out = { ...state }
      out[txid] = json
      return out
    }
    case SET_FILES: {
      const { files } = payload
      return recycle(files, state)
    }
  }
  return state
}

/**
 * Transaction list reducer.
 */
function txs (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case ADD_TXS: {
      const { txs, defaultCurrency } = payload
      const out = { ...state }
      for (const tx of txs) {
        out[tx.txid] = mergeTx(tx, defaultCurrency, out[tx.txid])
      }
      return out
    }
  }
  return state
}

/**
 * Individual wallet reducer.
 */
const currencyWallet = combineReducers({
  // Basic wallet stuff:
  engine: settableReducer(0, SET_ENGINE),
  plugin: constReducer(),

  // Settable data:
  balance: settableReducer({ currencyCode: null, balance: 0 }, SET_BALANCE),
  blockHeight: settableReducer(0, SET_BLOCK_HEIGHT),
  fiat: settableReducer('iso:USD', SET_FIAT),
  name: settableReducer(null, SET_NAME),
  nameLoaded: (state = false, action) =>
    action.type === SET_NAME ? true : state,
  progress: settableReducer(null, SET_PROGRESS),

  // Transaction data:
  files,
  txs
})

/**
 * Wallet list reducer.
 */
export default listReducer(currencyWallet, { ADD, UPDATE })

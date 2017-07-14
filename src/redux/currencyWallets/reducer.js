import { recycle } from '../../util/recycle.js'
import {
  constReducer,
  listReducer,
  settableReducer
} from '../../util/reducers.js'
import { combineReducers } from 'redux'

// Basic wallet list:
const ADD = 'airbitz-core-js/currencyWallet/ADD'
const UPDATE = 'airbitz-core-js/currencyWallet/UPDATE'

export function add (keyId, initialState) {
  return { type: ADD, payload: { id: keyId, initialState } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { id: keyId, action } }
}

// Wallet settable data:
const SET_BALANCE = 'airbitz-core-js/currencyWallet/balance/SET'
const SET_BLOCK_HEIGHT = 'airbitz-core-js/currencyWallet/blockHeight/SET'
const SET_NAME = 'airbitz-core-js/currencyWallet/name/SET'
const SET_PROGRESS = 'airbitz-core-js/currencyWallet/progress/SET'

export function setBalance (keyId, balance) {
  return update(keyId, { type: SET_BALANCE, payload: balance })
}

export function setBlockHeight (keyId, blockHeight) {
  return update(keyId, { type: SET_BLOCK_HEIGHT, payload: blockHeight })
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

export function addTxs (keyId, txs) {
  return update(keyId, { type: ADD_TXS, payload: { txs } })
}

export function setFile (keyId, txid, json) {
  return update(keyId, { type: SET_FILE, payload: { txid, json } })
}

export function setFiles (keyId, files) {
  return update(keyId, { type: SET_FILES, payload: { files } })
}

/**
 * Given a transaction from the plugin, make any fixes we need.
 */
function fixTx (tx) {
  const out = { ...tx }
  if (tx.nativeAmount == null) {
    out.nativeAmount = tx.amountSatoshi.toString()
  }
  if (tx.amountSatoshi == null) {
    out.amountSatoshi = parseInt(tx.nativeAmount)
  }
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
      const { txs } = payload
      const out = { ...state }
      for (const tx of txs) {
        out[tx.txid] = fixTx(tx)
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
  engine: constReducer(),
  plugin: constReducer(),

  // Settable data:
  balance: settableReducer(0, SET_BALANCE),
  blockHeight: settableReducer(0, SET_BLOCK_HEIGHT),
  name: settableReducer(null, SET_NAME),
  progress: settableReducer(null, SET_PROGRESS),

  // Transaction data:
  files,
  txs
})

/**
 * Wallet list reducer.
 */
export default listReducer(currencyWallet, { ADD, UPDATE })

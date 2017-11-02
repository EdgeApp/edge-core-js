import { combineReducers } from 'redux'

import {
  constReducer,
  listReducer,
  settableReducer
} from '../../util/redux/reducers.js'

const ADD = 'airbitz-core-js/storageWallet/ADD'
const UPDATE = 'airbitz-core-js/storageWallet/UPDATE'
const SET_STATUS = 'airbitz-core-js/storageWallet/SET_STATUS'

export function add (keyId, initialState) {
  return { type: ADD, payload: { id: keyId, initialState } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { id: keyId, action } }
}

export function setStatus (keyId, status) {
  return update(keyId, { type: SET_STATUS, payload: status })
}

/**
 * Individual wallet reducer.
 */
const storageWallet = combineReducers({
  localFolder: constReducer(),
  paths: constReducer(),
  status: settableReducer({}, SET_STATUS)
})

/**
 * Wallet list reducer.
 */
export default listReducer(storageWallet, { ADD, UPDATE })

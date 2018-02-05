// @flow

import { combineReducers } from 'redux'

import { listReducer } from '../../util/redux/reducers.js'
import type { RootAction } from '../actions.js'

export interface StorageWalletState {
  lastChanges: Array<string>;
  status: {
    lastHash: string | void,
    lastSync: number
  };
}

const ADD = 'airbitz-core-js/storageWallet/ADD'
const UPDATE = 'airbitz-core-js/storageWallet/UPDATE'

export function add (keyId: string, initialState: any) {
  return { type: ADD, payload: { id: keyId, initialState } }
}

export function update (keyId: string, action: RootAction) {
  return { type: UPDATE, payload: { id: keyId, action } }
}

/**
 * Individual repo reducer.
 */
const storageWallet = combineReducers({
  lastChanges (state = [], action: RootAction): Array<string> {
    if (action.type === 'REPO_SYNCED') {
      const { changes } = action.payload
      return changes.length ? changes : state
    }
    return state
  },

  localFolder (state = null) {
    return state
  },

  paths (state = null) {
    return state
  },

  status (state = { lastSync: 0 }, action: RootAction) {
    if (action.type === 'REPO_SYNCED') {
      return action.payload.status
    }
    return state
  }
})

/**
 * Wallet list reducer.
 */
export default listReducer(storageWallet, { ADD, UPDATE })

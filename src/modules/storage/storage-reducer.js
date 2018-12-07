// @flow

import { type Disklet } from 'disklet'
import { combineReducers } from 'redux'

import { type RootAction } from '../actions.js'

export type StorageWalletPaths = {
  dataKey: Uint8Array,
  syncKey: Uint8Array,

  baseDisklet: Disklet,
  changesDisklet: Disklet,
  dataDisklet: Disklet,
  disklet: Disklet
}

export type StorageWalletStatus = {
  lastHash: string | void,
  lastSync: number
}

export type StorageWalletState = {
  lastChanges: Array<string>,
  localDisklet: Disklet,
  paths: StorageWalletPaths,
  status: StorageWalletStatus
}

export type StorageWalletsState = { [id: string]: StorageWalletState }

/**
 * Individual repo reducer.
 */
const storageWalletReducer = combineReducers({
  lastChanges (state = [], action: RootAction): Array<string> {
    if (action.type === 'STORAGE_WALLET_SYNCED') {
      const { changes } = action.payload
      return changes.length ? changes : state
    }
    return state
  },

  localDisklet (state: any = null): Disklet {
    return state
  },

  paths (state: any = null): StorageWalletPaths {
    return state
  },

  status (
    state = { lastSync: 0, lastHash: void 0 },
    action: RootAction
  ): StorageWalletStatus {
    return action.type === 'STORAGE_WALLET_SYNCED'
      ? action.payload.status
      : state
  }
})

/**
 * Repo list reducer.
 */
export const storageWallets = function storageWalletsReducer (
  state: StorageWalletsState = {},
  action: RootAction
): StorageWalletsState {
  switch (action.type) {
    case 'STORAGE_WALLET_ADDED': {
      const { id, initialState } = action.payload
      const out = { ...state }
      out[id] = storageWalletReducer(initialState, { type: '' })
      return out
    }

    case 'STORAGE_WALLET_SYNCED': {
      const { id } = action.payload
      if (state[id] != null) {
        const out = { ...state }
        out[id] = storageWalletReducer(state[id], action)
        return out
      }
      return state
    }
  }
  return state
}

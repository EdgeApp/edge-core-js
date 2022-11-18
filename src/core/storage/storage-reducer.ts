import { Disklet } from 'disklet'
import { combineReducers } from 'redux'

import { RootAction } from '../actions'

export interface StorageWalletPaths {
  dataKey: Uint8Array
  syncKey: Uint8Array

  baseDisklet: Disklet
  changesDisklet: Disklet
  dataDisklet: Disklet
  disklet: Disklet
}

export interface StorageWalletStatus {
  lastHash: string | undefined
  lastSync: number
}

export interface StorageWalletState {
  lastChanges: string[]
  localDisklet: Disklet
  paths: StorageWalletPaths
  status: StorageWalletStatus
}

export interface StorageWalletsState {
  [id: string]: StorageWalletState
}

/**
 * Individual repo reducer.
 */
const storageWalletReducer = combineReducers<StorageWalletState, RootAction>({
  lastChanges(state = [], action): string[] {
    if (action.type === 'STORAGE_WALLET_SYNCED') {
      const { changes } = action.payload
      return changes.length > 0 ? changes : state
    }
    return state
  },

  localDisklet(state: any = null): Disklet {
    return state
  },

  paths(state: any = null): StorageWalletPaths {
    return state
  },

  status(
    state = { lastSync: 0, lastHash: undefined },
    action
  ): StorageWalletStatus {
    return action.type === 'STORAGE_WALLET_SYNCED'
      ? action.payload.status
      : state
  }
})

/**
 * Repo list reducer.
 */
export const storageWallets = function storageWalletsReducer(
  state: StorageWalletsState = {},
  action: RootAction
): StorageWalletsState {
  switch (action.type) {
    case 'STORAGE_WALLET_ADDED': {
      const { id, initialState } = action.payload
      const out: StorageWalletsState = { ...state }
      out[id] = storageWalletReducer(initialState, { type: 'UPDATE_NEXT' })
      return out
    }

    case 'STORAGE_WALLET_SYNCED': {
      const { id } = action.payload
      if (state[id] != null) {
        const out: StorageWalletsState = { ...state }
        out[id] = storageWalletReducer(state[id], action)
        return out
      }
      return state
    }
  }
  return state
}

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

/**
 * - unsubscribed: no subscription on a live socket; polling runs.
 * - subscribing: a `subscribeRepos` call is in flight; polling runs.
 * - listening: the socket reports changes; polling stops.
 * - syncing: listening, with a notified pull in flight; polling stops.
 * - avoiding: the server refused or a pull failed; polling runs
 *   until the socket reconnects.
 */
export type StorageWalletSubscriptionStatus =
  | 'unsubscribed'
  | 'subscribing'
  | 'listening'
  | 'syncing'
  | 'avoiding'

export interface StorageWalletSubscription {
  status: StorageWalletSubscriptionStatus

  /**
   * The repo was loaded from disk, and its first sync this session
   * is left to the subscription result. Cleared by any sync.
   */
  syncOwed: boolean
}

export interface StorageWalletState {
  lastChanges: string[]
  localDisklet: Disklet
  paths: StorageWalletPaths
  status: StorageWalletStatus
  subscription: StorageWalletSubscription
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
  },

  /**
   * Subscription bookkeeping. This never holds a checkpoint:
   * a resubscribe must carry `status.lastHash`, which only a
   * completed sync writes, so a notification that arrives before
   * a crash is still reported as a change on the next launch.
   */
  subscription(
    state = { status: 'unsubscribed', syncOwed: false },
    action
  ): StorageWalletSubscription {
    if (action.type === 'STORAGE_WALLET_SYNCED') {
      return state.syncOwed ? { ...state, syncOwed: false } : state
    }
    return state
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

    case 'STORAGE_WALLETS_SUBSCRIPTIONS_CHANGED': {
      const { subscriptions } = action.payload
      let out: StorageWalletsState | undefined
      for (const id of Object.keys(subscriptions)) {
        const old = state[id]
        if (old == null) continue
        const { status, syncOwed = old.subscription.syncOwed } =
          subscriptions[id]
        if (
          status === old.subscription.status &&
          syncOwed === old.subscription.syncOwed
        ) {
          continue
        }
        if (out == null) out = { ...state }
        out[id] = { ...old, subscription: { status, syncOwed } }
      }
      return out ?? state
    }
  }
  return state
}

// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type { EdgeAccountCallbacks } from '../../edge-core-index.js'
import type { RootAction } from '../actions.js'
import { hasCurrencyPlugin } from '../currency/currency-selectors.js'
import type { WalletInfoMap } from '../login/login-types.js'
import type { RootState } from '../root-reducer.js'

export type AccountState = {
  +allWalletInfos: WalletInfoMap,
  +currencyWalletIds: Array<string>,
  +activeWalletIds: Array<string>,
  +archivedWalletIds: Array<string>,
  +appId: string,
  +callbacks: EdgeAccountCallbacks,
  +loginKey: Uint8Array,
  +username: string
}

export type AccountNext = {
  +id: string,
  +root: RootState,
  +self: AccountState
}

const account = buildReducer({
  allWalletInfos (state = {}, action: RootAction): WalletInfoMap {
    if (action.type === 'ACCOUNT_KEYS_LOADED') {
      const out = {}
      for (const info of action.payload.walletInfos) {
        out[info.id] = info
      }
      return out
    }
    return state
  },

  currencyWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfos,
    (next: AccountNext) => next.root.currency.infos,
    (allWalletInfos, currencyInfos): Array<string> =>
      Object.keys(allWalletInfos)
        .filter(walletId => {
          const info = allWalletInfos[walletId]
          return !info.deleted && hasCurrencyPlugin(currencyInfos, info.type)
        })
        .sort((walletId1, walletId2) => {
          const info1 = allWalletInfos[walletId1]
          const info2 = allWalletInfos[walletId2]
          return info1.sortIndex - info2.sortIndex
        })
  ),

  activeWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (walletInfos, ids): Array<string> =>
      ids.filter(id => !walletInfos[id].archived)
  ),

  archivedWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (walletInfos, ids): Array<string> =>
      ids.filter(id => walletInfos[id].archived)
  ),

  appId (state, action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.appId : state
  },

  callbacks (state, action: RootAction): EdgeAccountCallbacks {
    return action.type === 'LOGIN' ? action.payload.callbacks : state
  },

  loginKey (state, action: RootAction): Uint8Array {
    return action.type === 'LOGIN' ? action.payload.loginKey : state
  },

  username (state, action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.username : state
  }
})

export default filterReducer(
  account,
  (action: RootAction, next: AccountNext) => {
    if (
      action.type === 'ACCOUNT_KEYS_LOADED' &&
      action.payload.accountId === next.id
    ) {
      return action
    }

    if (action.type === 'LOGIN' && next.root.lastAccountId === next.id) {
      return action
    }
  }
)

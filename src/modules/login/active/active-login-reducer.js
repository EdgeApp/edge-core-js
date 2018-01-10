// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type { EdgeAccountCallbacks } from '../../../edge-core-index.js'
import type { RootAction } from '../../actions.js'
import { hasCurrencyPlugin } from '../../currency/currency-selectors.js'
import type { RootState } from '../../root-reducer.js'
import type { WalletInfoMap } from '../login-types.js'

export interface ActiveLoginState {
  allWalletInfos: WalletInfoMap;
  currencyWalletIds: Array<string>;
  activeWalletIds: Array<string>;
  archivedWalletIds: Array<string>;
  appId: string;
  callbacks: EdgeAccountCallbacks;
  loginKey: Uint8Array;
  username: string;
}

export interface ActiveLoginNext {
  id: string;
  root: RootState;
  +self: ActiveLoginState;
}

const activeLogin = buildReducer({
  allWalletInfos (state: WalletInfoMap = {}, action: RootAction): WalletInfoMap {
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
    (next: ActiveLoginNext) => next.self.allWalletInfos,
    (next: ActiveLoginNext) => next.root.currency.infos,
    (allWalletInfos, currencyInfos) =>
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
    (next: ActiveLoginNext) => next.self.allWalletInfos,
    (next: ActiveLoginNext) => next.self.currencyWalletIds,
    (walletInfos, ids) => ids.filter(id => !walletInfos[id].archived)
  ),

  archivedWalletIds: memoizeReducer(
    (next: ActiveLoginNext) => next.self.allWalletInfos,
    (next: ActiveLoginNext) => next.self.currencyWalletIds,
    (walletInfos, ids) => ids.filter(id => walletInfos[id].archived)
  ),

  appId (state: string, action: RootAction) {
    return action.type === 'LOGIN' ? action.payload.appId : state
  },

  callbacks (state: string, action: RootAction) {
    return action.type === 'LOGIN' ? action.payload.callbacks : state
  },

  loginKey (state: Uint8Array, action: RootAction) {
    return action.type === 'LOGIN' ? action.payload.loginKey : state
  },

  username (state: string, action: RootAction) {
    return action.type === 'LOGIN' ? action.payload.username : state
  }
})

export default filterReducer(
  activeLogin,
  (action: RootAction, next: ActiveLoginNext) => {
    if (
      action.type === 'ACCOUNT_KEYS_LOADED' &&
      action.payload.activeLoginId === next.id
    ) {
      return action
    }

    if (
      action.type === 'LOGIN' &&
      next.root.login.lastActiveLoginId === next.id
    ) {
      return action
    }
  }
)

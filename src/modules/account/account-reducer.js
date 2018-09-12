// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type {
  EdgeAccountCallbacks,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../edge-core-index.js'
import type { RootAction } from '../actions.js'
import { hasCurrencyPlugin } from '../currency/currency-selectors.js'
import {
  findFirstKey,
  getAllWalletInfos,
  makeAccountType
} from '../login/keys.js'
import type { LoginTree, WalletInfoMap } from '../login/login-types.js'
import { makeLoginTree } from '../login/login.js'
import type { RootState } from '../root-reducer.js'
import { findAppLogin } from './account-init.js'

export type PluginSettings = { [pluginName: string]: Object }

export type AccountState = {
  // Wallet stuff:
  +accountWalletInfo: EdgeWalletInfo,
  +allWalletInfosFull: Array<EdgeWalletInfoFull>,
  +allWalletInfos: WalletInfoMap,
  +currencyWalletIds: Array<string>,
  +activeWalletIds: Array<string>,
  +archivedWalletIds: Array<string>,
  +legacyWalletInfos: Array<EdgeWalletInfo>,
  +walletStates: EdgeWalletStates,

  // Login stuff:
  +appId: string, // Copy of the context appId
  +callbacks: EdgeAccountCallbacks,
  +loadFailure: Error | null, // Failed to create API object.
  +login: LoginTree,
  +loginKey: Uint8Array,
  +loginTree: LoginTree,
  +loginType: string,
  +rootLogin: boolean, // True if the loginKey is for the root
  +username: string
}

export type AccountNext = {
  +id: string,
  +root: RootState,
  +self: AccountState
}

const account = buildReducer({
  accountWalletInfo: memoizeReducer(
    (next: AccountNext) => next.self.appId,
    (next: AccountNext) => next.self.login,
    (appId: string, login: LoginTree): EdgeWalletInfo => {
      const type = makeAccountType(appId)
      const accountWalletInfo = findFirstKey(login.keyInfos, type)
      if (accountWalletInfo == null) {
        throw new Error(`Cannot find a "${type}" repo`)
      }
      return accountWalletInfo
    }
  ),

  allWalletInfosFull: memoizeReducer(
    (next: AccountNext) => next.self.login,
    (next: AccountNext) => next.self.legacyWalletInfos,
    (next: AccountNext) => next.self.walletStates,
    (
      login: LoginTree,
      legacyWalletInfos: Array<EdgeWalletInfo>,
      walletStates: EdgeWalletStates
    ): Array<EdgeWalletInfoFull> => {
      const values = getAllWalletInfos(login, legacyWalletInfos)
      const { walletInfos, appIdMap } = values
      const getLast = array => array[array.length - 1]

      return walletInfos.map(info => ({
        appId: getLast(appIdMap[info.id]),
        appIds: appIdMap[info.id],
        archived: false,
        deleted: false,
        sortIndex: walletInfos.length,
        ...walletStates[info.id],
        ...info
      }))
    }
  ),

  allWalletInfos: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: Array<EdgeWalletInfoFull>): WalletInfoMap => {
      const out = {}
      for (const info of walletInfos) {
        out[info.id] = info
      }
      return out
    }
  ),

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

  legacyWalletInfos (state = [], action: RootAction): Array<EdgeWalletInfo> {
    return action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.legacyWalletInfos
      : state
  },

  walletStates (state = {}, action: RootAction): EdgeWalletStates {
    return action.type === 'ACCOUNT_CHANGED_WALLET_STATES' ||
      action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.walletStates
      : state
  },

  appId (state, action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.appId : state
  },

  callbacks (state, action: RootAction): EdgeAccountCallbacks {
    return action.type === 'LOGIN' ? action.payload.callbacks : state
  },

  loadFailure (state = null, action: RootAction): Error | null {
    return action.type === 'ACCOUNT_LOAD_FAILED' ? action.payload.error : state
  },

  login: memoizeReducer(
    (next: AccountNext) => next.self.appId,
    (next: AccountNext) => next.self.loginTree,
    (appId, loginTree): LoginTree => findAppLogin(loginTree, appId)
  ),

  loginKey (state, action: RootAction): Uint8Array {
    return action.type === 'LOGIN' ? action.payload.loginKey : state
  },

  loginTree: memoizeReducer(
    (next: AccountNext) => next.self.appId,
    (next: AccountNext) => next.self.loginKey,
    (next: AccountNext) => next.self.rootLogin,
    (next: AccountNext) => next.root.login.stashes[next.self.username],
    (appId, loginKey, rootLogin, stashTree): LoginTree =>
      makeLoginTree(stashTree, loginKey, rootLogin ? '' : appId)
  ),

  loginType (state, action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.loginType : state
  },

  rootLogin (state, action: RootAction): boolean {
    return action.type === 'LOGIN' ? action.payload.rootLogin : state
  },

  username (state, action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.username : state
  }
})

export default filterReducer(
  account,
  (action: RootAction, next: AccountNext) => {
    if (/^ACCOUNT_/.test(action.type) && action.payload.accountId === next.id) {
      return action
    }

    if (action.type === 'LOGIN' && next.root.lastAccountId === next.id) {
      return action
    }

    return { type: 'PROPS_UPDATE' }
  }
)

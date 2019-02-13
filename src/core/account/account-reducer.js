// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import {
  type EdgeAccountCallbacks,
  type EdgePluginMap,
  type EdgeSwapTools,
  type EdgeWalletInfo,
  type EdgeWalletInfoFull,
  type EdgeWalletStates
} from '../../types/types.js'
import { ethereumKeyToAddress } from '../../util/crypto/ethereum.js'
import { type RootAction } from '../actions.js'
import {
  findFirstKey,
  getAllWalletInfos,
  makeAccountType
} from '../login/keys.js'
import { type LoginTree, type WalletInfoMap } from '../login/login-types.js'
import { makeLoginTree } from '../login/login.js'
import { findCurrencyPlugin } from '../plugins/plugins-selectors.js'
import { type RootState } from '../root-reducer.js'
import { findAppLogin } from './account-init.js'

export type SwapSettings = {
  enabled?: boolean
}

export type AccountState = {
  // Wallet stuff:
  +accountWalletInfo: EdgeWalletInfo,
  +accountWalletInfos: Array<EdgeWalletInfo>,
  +allWalletInfosFull: Array<EdgeWalletInfoFull>,
  +allWalletInfosClean: Array<EdgeWalletInfoFull>,
  +currencyWalletIds: Array<string>,
  +activeWalletIds: Array<string>,
  +archivedWalletIds: Array<string>,
  +keysLoaded: boolean,
  +legacyWalletInfos: Array<EdgeWalletInfo>,
  +walletInfos: WalletInfoMap,
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
  +username: string,

  // Plugin stuff:
  +swapSettings: EdgePluginMap<SwapSettings>,
  +userSettings: EdgePluginMap<Object>,
  +swapTools: EdgePluginMap<EdgeSwapTools>
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

  accountWalletInfos: memoizeReducer(
    (next: AccountNext) => next.self.appId,
    (next: AccountNext) => next.self.login,
    (appId: string, login: LoginTree): Array<EdgeWalletInfo> => {
      // Wallets created in Edge that then log into Airbitz or BitcoinPay
      // might end up with wallets stored in the wrong account repo.
      // This code attempts to locate those repos.
      const walletTypes = [makeAccountType(appId)]
      if (appId === '') walletTypes.push('account:repo:co.airbitz.wallet', '')
      return login.keyInfos.filter(info => walletTypes.indexOf(info.type) >= 0)
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

  allWalletInfosClean: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: Array<EdgeWalletInfoFull>): Array<EdgeWalletInfoFull> =>
      walletInfos.map(info => {
        const keys =
          info.type === 'wallet:ethereum'
            ? { ethereumAddress: ethereumKeyToAddress(info.keys.ethereumKey) }
            : {}
        return { ...info, keys }
      })
  ),

  currencyWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.root.plugins.currency,
    (walletInfos, plugins): Array<string> =>
      Object.keys(walletInfos)
        .filter(walletId => {
          const info = walletInfos[walletId]
          return !info.deleted && findCurrencyPlugin(plugins, info.type) != null
        })
        .sort((walletId1, walletId2) => {
          const info1 = walletInfos[walletId1]
          const info2 = walletInfos[walletId2]
          return info1.sortIndex - info2.sortIndex
        })
  ),

  activeWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (next: AccountNext) => next.self.keysLoaded,
    (walletInfos, ids, keysLoaded): Array<string> =>
      keysLoaded ? ids.filter(id => !walletInfos[id].archived) : []
  ),

  archivedWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (next: AccountNext) => next.self.keysLoaded,
    (walletInfos, ids, keysLoaded): Array<string> =>
      keysLoaded ? ids.filter(id => walletInfos[id].archived) : []
  ),

  keysLoaded (state = false, action: RootAction): boolean {
    return action.type === 'ACCOUNT_KEYS_LOADED' ? true : state
  },

  legacyWalletInfos (state = [], action: RootAction): Array<EdgeWalletInfo> {
    return action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.legacyWalletInfos
      : state
  },

  walletInfos: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: Array<EdgeWalletInfoFull>): WalletInfoMap => {
      const out = {}
      for (const info of walletInfos) {
        out[info.id] = info
      }
      return out
    }
  ),

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
  },

  swapSettings (state = {}, action: RootAction): EdgePluginMap<SwapSettings> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        return action.payload.swapSettings

      case 'ACCOUNT_SWAP_SETTINGS_CHANGED':
        const { pluginName, swapSettings } = action.payload
        const out = { ...state }
        out[pluginName] = swapSettings
        return out
    }
    return state
  },

  userSettings (state = {}, action: RootAction): EdgePluginMap<Object> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_CHANGED':
        const { pluginName, userSettings } = action.payload
        const out = { ...state }
        out[pluginName] = userSettings
        return out

      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        return action.payload.userSettings
    }
    return state
  },

  swapTools (state = {}, action: RootAction): EdgePluginMap<EdgeSwapTools> {
    return action.type === 'ACCOUNT_PLUGIN_TOOLS_LOADED'
      ? action.payload.swapTools
      : state
  }
})

export const accountReducer = filterReducer(
  account,
  (action: RootAction, next: AccountNext) => {
    if (
      /^ACCOUNT_/.test(action.type) &&
      action.payload != null &&
      action.payload.accountId === next.id
    ) {
      return action
    }

    if (action.type === 'LOGIN' && next.root.lastAccountId === next.id) {
      return action
    }

    return { type: 'PROPS_UPDATE' }
  }
)

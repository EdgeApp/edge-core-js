// @flow

import {
  type FatReducer,
  buildReducer,
  filterReducer,
  memoizeReducer
} from 'redux-keto'

import {
  type EdgePluginMap,
  type EdgeWalletInfo,
  type EdgeWalletInfoFull,
  type EdgeWalletStates,
  type JsonObject
} from '../../types/types.js'
import { ethereumKeyToAddress } from '../../util/crypto/ethereum.js'
import { type RootAction } from '../actions.js'
import {
  findFirstKey,
  getAllWalletInfos,
  makeAccountType
} from '../login/keys.js'
import { type LoginTree, type WalletInfoFullMap } from '../login/login-types.js'
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
  +accountWalletInfos: EdgeWalletInfo[],
  +allWalletInfosFull: EdgeWalletInfoFull[],
  +allWalletInfosClean: EdgeWalletInfoFull[],
  +currencyWalletIds: string[],
  +activeWalletIds: string[],
  +archivedWalletIds: string[],
  +hiddenWalletIds: string[],
  +keysLoaded: boolean,
  +legacyWalletInfos: EdgeWalletInfo[],
  +walletInfos: WalletInfoFullMap,
  +walletStates: EdgeWalletStates,

  // Login stuff:
  +appId: string, // Copy of the context appId
  +loadFailure: Error | null, // Failed to create API object.
  +login: LoginTree,
  +loginKey: Uint8Array,
  +loginTree: LoginTree,
  +loginType: string,
  +rootLogin: boolean, // True if the loginKey is for the root
  +username: string,

  // Plugin stuff:
  +swapSettings: EdgePluginMap<SwapSettings>,
  +userSettings: EdgePluginMap<JsonObject>
}

export type AccountNext = {
  +id: string,
  +root: RootState,
  +self: AccountState
}

const accountInner: FatReducer<
  AccountState,
  RootAction,
  AccountNext
> = buildReducer({
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
    (appId: string, login: LoginTree): EdgeWalletInfo[] => {
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
      legacyWalletInfos: EdgeWalletInfo[],
      walletStates: EdgeWalletStates
    ): EdgeWalletInfoFull[] => {
      const values = getAllWalletInfos(login, legacyWalletInfos)
      const { walletInfos, appIdMap } = values

      return walletInfos.map(info => ({
        appId: getLast(appIdMap[info.id]),
        appIds: appIdMap[info.id],
        archived: false,
        deleted: false,
        hidden: false,
        sortIndex: walletInfos.length,
        ...walletStates[info.id],
        ...info
      }))
    }
  ),

  allWalletInfosClean: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: EdgeWalletInfoFull[]): EdgeWalletInfoFull[] =>
      walletInfos.map(info => {
        const keys =
          info.type === 'wallet:ethereum' &&
          typeof info.keys.ethereumKey === 'string'
            ? { ethereumAddress: ethereumKeyToAddress(info.keys.ethereumKey) }
            : {}
        return { ...info, keys }
      })
  ),

  currencyWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.root.plugins.currency,
    (walletInfos, plugins): string[] =>
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
    (walletInfos, ids, keysLoaded): string[] =>
      keysLoaded ? ids.filter(id => !walletInfos[id].archived) : []
  ),

  archivedWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (next: AccountNext) => next.self.keysLoaded,
    (walletInfos, ids, keysLoaded): string[] =>
      keysLoaded ? ids.filter(id => walletInfos[id].archived) : []
  ),

  hiddenWalletIds: memoizeReducer(
    (next: AccountNext) => next.self.walletInfos,
    (next: AccountNext) => next.self.currencyWalletIds,
    (next: AccountNext) => next.self.keysLoaded,
    (walletInfos, ids, keysLoaded): string[] =>
      keysLoaded ? ids.filter(id => walletInfos[id].hidden) : []
  ),

  keysLoaded(state = false, action: RootAction): boolean {
    return action.type === 'ACCOUNT_KEYS_LOADED' ? true : state
  },

  legacyWalletInfos(state = [], action: RootAction): EdgeWalletInfo[] {
    return action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.legacyWalletInfos
      : state
  },

  walletInfos: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: EdgeWalletInfoFull[]): WalletInfoFullMap => {
      const out = {}
      for (const info of walletInfos) {
        out[info.id] = info
      }
      return out
    }
  ),

  walletStates(state = {}, action: RootAction): EdgeWalletStates {
    return action.type === 'ACCOUNT_CHANGED_WALLET_STATES' ||
      action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.walletStates
      : state
  },

  appId(state = '', action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.appId : state
  },

  loadFailure(state = null, action: RootAction): Error | null {
    return action.type === 'ACCOUNT_LOAD_FAILED' ? action.payload.error : state
  },

  login: memoizeReducer(
    (next: AccountNext) => next.self.appId,
    (next: AccountNext) => next.self.loginTree,
    (appId, loginTree): LoginTree => findAppLogin(loginTree, appId)
  ),

  loginKey(state = new Uint8Array(0), action: RootAction): Uint8Array {
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

  loginType(state = '', action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.loginType : state
  },

  rootLogin(state = true, action: RootAction): boolean {
    return action.type === 'LOGIN' ? action.payload.rootLogin : state
  },

  username(state = '', action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.username : state
  },

  swapSettings(state = {}, action: RootAction): EdgePluginMap<SwapSettings> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        return action.payload.swapSettings

      case 'ACCOUNT_SWAP_SETTINGS_CHANGED': {
        const { pluginId, swapSettings } = action.payload
        const out = { ...state }
        out[pluginId] = swapSettings
        return out
      }
    }
    return state
  },

  userSettings(state = {}, action: RootAction): EdgePluginMap<JsonObject> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_CHANGED': {
        const { pluginId, userSettings } = action.payload
        const out = { ...state }
        out[pluginId] = userSettings
        return out
      }

      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        return action.payload.userSettings
    }
    return state
  }
})

export const accountReducer: FatReducer<
  AccountState,
  RootAction,
  AccountNext
> = filterReducer(
  accountInner,
  (action: RootAction, next: AccountNext): RootAction => {
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

    return { type: 'UPDATE_NEXT' }
  }
)

function getLast<T>(array: T[]): T {
  return array[array.length - 1]
}

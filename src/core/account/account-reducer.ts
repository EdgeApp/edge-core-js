import {
  buildReducer,
  FatReducer,
  filterReducer,
  memoizeReducer
} from 'redux-keto'

import {
  EdgePluginMap,
  EdgeTokenMap,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates,
  JsonObject
} from '../../types/types'
import { compare } from '../../util/compare'
import { ethereumKeyToAddress } from '../../util/crypto/ethereum'
import { RootAction } from '../actions'
import { findFirstKey, getAllWalletInfos, makeAccountType } from '../login/keys'
import { makeLoginTree } from '../login/login'
import { LoginTree, LoginType, WalletInfoFullMap } from '../login/login-types'
import { maybeFindCurrencyPluginId } from '../plugins/plugins-selectors'
import { RootState } from '../root-reducer'
import { findAppLogin } from './account-init'
import { SwapSettings } from './account-types'

export interface AccountState {
  // Wallet stuff:
  readonly accountWalletInfo: EdgeWalletInfo
  readonly accountWalletInfos: EdgeWalletInfo[]
  readonly allWalletInfosFull: EdgeWalletInfoFull[]
  readonly allWalletInfosClean: EdgeWalletInfoFull[]
  readonly currencyWalletIds: string[]
  readonly activeWalletIds: string[]
  readonly archivedWalletIds: string[]
  readonly hiddenWalletIds: string[]
  readonly keysLoaded: boolean
  readonly legacyWalletInfos: EdgeWalletInfo[]
  readonly walletInfos: WalletInfoFullMap
  readonly walletStates: EdgeWalletStates
  readonly pauseWallets: boolean

  // Login stuff:
  readonly appId: string // Copy of the context appId
  readonly loadFailure: Error | null // Failed to create API object.
  readonly login: LoginTree
  readonly loginKey: Uint8Array
  readonly loginTree: LoginTree
  readonly loginType: LoginType
  readonly rootLogin: boolean // True if the loginKey is for the root
  readonly username: string

  // Plugin stuff:
  readonly allTokens: EdgePluginMap<EdgeTokenMap>
  readonly builtinTokens: EdgePluginMap<EdgeTokenMap>
  readonly customTokens: EdgePluginMap<EdgeTokenMap>
  readonly alwaysEnabledTokenIds: EdgePluginMap<string[]>
  readonly swapSettings: EdgePluginMap<SwapSettings>
  readonly userSettings: EdgePluginMap<JsonObject>
}

export interface AccountNext {
  readonly id: string
  readonly root: RootState
  readonly self: AccountState
}

export const initialCustomTokens: EdgePluginMap<EdgeTokenMap> = {}

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
      return login.keyInfos.filter(info => walletTypes.includes(info.type))
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
          const pluginId = maybeFindCurrencyPluginId(plugins, info.type)
          return !info.deleted && pluginId != null
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
      const out: WalletInfoFullMap = {}
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

  pauseWallets(state: boolean = false, action: RootAction): boolean {
    return action.type === 'LOGIN' ? action.payload.pauseWallets : state
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

  loginType(state = 'newAccount', action: RootAction): LoginType {
    return action.type === 'LOGIN' ? action.payload.loginType : state
  },

  rootLogin(state = true, action: RootAction): boolean {
    return action.type === 'LOGIN' ? action.payload.rootLogin : state
  },

  username(state = '', action: RootAction): string {
    return action.type === 'LOGIN' ? action.payload.username : state
  },

  allTokens(
    state: EdgePluginMap<EdgeTokenMap> = {},
    action: RootAction,
    next: AccountNext,
    prev: AccountNext
  ): EdgePluginMap<EdgeTokenMap> {
    const { builtinTokens, customTokens } = next.self

    // Roll our own `memoizeReducer` implementation,
    // so we can minimize our diff as much as possible:
    if (
      prev.self == null ||
      builtinTokens !== prev.self.builtinTokens ||
      customTokens !== prev.self.customTokens
    ) {
      const out = { ...state }
      for (const pluginId of Object.keys(next.root.plugins.currency)) {
        if (
          prev.self == null ||
          builtinTokens[pluginId] !== prev.self.builtinTokens[pluginId] ||
          customTokens[pluginId] !== prev.self.customTokens[pluginId]
        ) {
          out[pluginId] = {
            ...customTokens[pluginId],
            ...builtinTokens[pluginId]
          }
        }
      }
      return out
    }
    return state
  },

  builtinTokens(state = {}, action: RootAction): EdgePluginMap<EdgeTokenMap> {
    switch (action.type) {
      case 'ACCOUNT_BUILTIN_TOKENS_LOADED': {
        const { pluginId, tokens } = action.payload
        return { ...state, [pluginId]: tokens }
      }
    }
    return state
  },

  customTokens(
    state = initialCustomTokens,
    action: RootAction
  ): EdgePluginMap<EdgeTokenMap> {
    switch (action.type) {
      case 'ACCOUNT_CUSTOM_TOKENS_LOADED': {
        const { customTokens } = action.payload
        return customTokens
      }
      case 'ACCOUNT_CUSTOM_TOKEN_ADDED': {
        const { pluginId, tokenId, token } = action.payload
        const oldList = state[pluginId] ?? {}

        // Has anything changed?
        if (compare(oldList[tokenId], token)) return state

        const newList = { ...oldList, [tokenId]: token }
        return { ...state, [pluginId]: newList }
      }
      case 'ACCOUNT_CUSTOM_TOKEN_REMOVED': {
        const { pluginId, tokenId } = action.payload
        const oldList = state[pluginId] ?? {}

        // Has anything changed?
        if (oldList[tokenId] == null) return state

        const { [tokenId]: unused, ...newList } = oldList
        return { ...state, [pluginId]: newList }
      }
    }
    return state
  },

  alwaysEnabledTokenIds(
    state: EdgePluginMap<string[]> = {},
    action: RootAction
  ): EdgePluginMap<string[]> {
    switch (action.type) {
      case 'ACCOUNT_ALWAYS_ENABLED_TOKENS_CHANGED': {
        const { pluginId, tokenIds } = action.payload
        return { ...state, [pluginId]: tokenIds }
      }
    }
    return state
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

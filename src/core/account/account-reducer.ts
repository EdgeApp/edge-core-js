import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import {
  EdgePluginMap,
  EdgeTokenMap,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../types/types'
import { compare } from '../../util/compare'
import { verifyData } from '../../util/crypto/verify'
import { RootAction } from '../actions'
import {
  decryptAllWalletInfos,
  findFirstKey,
  makeAccountType
} from '../login/keys'
import { makeLoginTree, searchTree } from '../login/login'
import { LoginStash } from '../login/login-stash'
import {
  LoginTree,
  LoginType,
  SessionKey,
  WalletInfoFullMap
} from '../login/login-types'
import { maybeFindCurrencyPluginId } from '../plugins/plugins-selectors'
import { RootState } from '../root-reducer'
import { SwapSettings } from './account-types'

export interface AccountState {
  // Wallet stuff:
  readonly accountWalletInfo: EdgeWalletInfo
  readonly accountWalletInfos: EdgeWalletInfo[]
  readonly allWalletInfosFull: EdgeWalletInfoFull[]
  readonly allWalletInfosClean: EdgeWalletInfoFull[]
  readonly currencyWalletErrors: { [walletId: string]: Error }
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
  readonly activeAppId: string
  readonly loadFailure: Error | null // Failed to create API object.
  readonly login: LoginTree
  readonly loginTree: LoginTree
  readonly loginType: LoginType
  readonly rootLoginId: Uint8Array
  readonly sessionKey: SessionKey
  // TODO: add stash state for the account's decrypted stash data as an
  // alternative to `login: LoginTree`, which is deprecated:
  // stash: LoginStash
  readonly stashTree: LoginStash

  // Plugin stuff:
  readonly allTokens: EdgePluginMap<EdgeTokenMap>
  readonly builtinTokens: EdgePluginMap<EdgeTokenMap>
  readonly customTokens: EdgePluginMap<EdgeTokenMap>
  readonly alwaysEnabledTokenIds: EdgePluginMap<string[]>
  readonly swapSettings: EdgePluginMap<SwapSettings>
  readonly userSettings: EdgePluginMap<object>
}

export interface AccountNext {
  readonly id: string
  readonly root: RootState
  readonly self: AccountState
}

export const initialCustomTokens: EdgePluginMap<EdgeTokenMap> = {}
const blankSessionKey = {
  loginId: new Uint8Array(),
  loginKey: new Uint8Array()
}

const accountInner = buildReducer<AccountState, RootAction, AccountNext>({
  accountWalletInfo: memoizeReducer(
    (next: AccountNext) => next.self.activeAppId,
    (next: AccountNext) => next.self.allWalletInfosFull,
    (appId, walletInfos): EdgeWalletInfo => {
      const type = makeAccountType(appId)
      const accountWalletInfo = findFirstKey(walletInfos, type)
      if (accountWalletInfo == null) {
        throw new Error(`Cannot find a "${type}" repo`)
      }
      return accountWalletInfo
    }
  ),

  accountWalletInfos: memoizeReducer(
    (next: AccountNext) => next.self.activeAppId,
    (next: AccountNext) => next.self.allWalletInfosFull,
    (appId, walletInfos): EdgeWalletInfo[] => {
      // Wallets created in Edge that then log into Airbitz or BitcoinPay
      // might end up with wallets stored in the wrong account repo.
      // This code attempts to locate those repos.
      const walletTypes = [makeAccountType(appId)]
      if (appId === '') walletTypes.push('account:repo:co.airbitz.wallet', '')
      return walletInfos.filter(info => walletTypes.includes(info.type))
    }
  ),

  allWalletInfosFull: memoizeReducer(
    (next: AccountNext) => next.self.stashTree,
    (next: AccountNext) => next.self.login,
    (next: AccountNext) => next.self.legacyWalletInfos,
    (next: AccountNext) => next.self.walletStates,
    (
      stashTree,
      appSessionKey,
      legacyWalletInfos,
      walletStates
    ): EdgeWalletInfoFull[] =>
      decryptAllWalletInfos(
        stashTree,
        appSessionKey,
        legacyWalletInfos,
        walletStates
      )
  ),

  allWalletInfosClean: memoizeReducer(
    (next: AccountNext) => next.self.allWalletInfosFull,
    (walletInfos: EdgeWalletInfoFull[]): EdgeWalletInfoFull[] =>
      walletInfos.map(info => ({ ...info, keys: {} }))
  ),

  currencyWalletErrors(state = {}, action, next, prev) {
    const { activeWalletIds } = next.self
    const walletStates = next.root.currency.wallets
    let dirty = activeWalletIds !== prev.self?.activeWalletIds

    const out: { [walletId: string]: Error } = {}
    for (const id of activeWalletIds) {
      const failure = walletStates[id].engineFailure
      if (failure != null) out[id] = failure
      if (out[id] !== state[id]) dirty = true
    }
    return dirty ? out : state
  },

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

  keysLoaded(state = false, action): boolean {
    return action.type === 'ACCOUNT_KEYS_LOADED' ? true : state
  },

  legacyWalletInfos(state = [], action): EdgeWalletInfo[] {
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

  walletStates(state = {}, action): EdgeWalletStates {
    return action.type === 'ACCOUNT_CHANGED_WALLET_STATES' ||
      action.type === 'ACCOUNT_KEYS_LOADED'
      ? action.payload.walletStates
      : state
  },

  pauseWallets(state = false, action): boolean {
    return action.type === 'LOGIN' ? action.payload.pauseWallets : state
  },

  activeAppId: (state = '', action): string => {
    return action.type === 'LOGIN' ? action.payload.appId : state
  },

  loadFailure(state = null, action): Error | null {
    if (action.type === 'ACCOUNT_LOAD_FAILED') {
      const { error } = action.payload
      if (error instanceof Error) return error
      return new Error(String(error))
    }
    return state
  },

  login: memoizeReducer(
    (next: AccountNext) => next.self.activeAppId,
    (next: AccountNext) => next.self.loginTree,
    (appId, loginTree): LoginTree => {
      const out = searchTree(loginTree, login => login.appId === appId)
      if (out == null) {
        throw new Error(`Internal error: cannot find login for ${appId}`)
      }
      return out
    }
  ),

  loginTree: memoizeReducer(
    (next: AccountNext) => next.self.stashTree,
    (next: AccountNext) => next.self.sessionKey,
    (stashTree, sessionKey): LoginTree => makeLoginTree(stashTree, sessionKey)
  ),

  loginType(state = 'newAccount', action): LoginType {
    return action.type === 'LOGIN' ? action.payload.loginType : state
  },

  rootLoginId(state = new Uint8Array(0), action): Uint8Array {
    return action.type === 'LOGIN' ? action.payload.rootLoginId : state
  },

  sessionKey(state = blankSessionKey, action): SessionKey {
    return action.type === 'LOGIN' ? action.payload.sessionKey : state
  },

  stashTree: memoizeReducer(
    (next: AccountNext) => next.self.rootLoginId,
    (next: AccountNext) => next.root.login.stashes,
    (rootLoginId, stashes) => {
      for (const stash of stashes) {
        if (verifyData(stash.loginId, rootLoginId)) return stash
      }
      throw new Error('There is no stash')
    }
  ),

  allTokens(state = {}, action, next, prev): EdgePluginMap<EdgeTokenMap> {
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

  builtinTokens(state = {}, action): EdgePluginMap<EdgeTokenMap> {
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
    action
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

  alwaysEnabledTokenIds(state = {}, action): EdgePluginMap<string[]> {
    switch (action.type) {
      case 'ACCOUNT_ALWAYS_ENABLED_TOKENS_CHANGED': {
        const { pluginId, tokenIds } = action.payload
        return { ...state, [pluginId]: tokenIds }
      }
    }
    return state
  },

  swapSettings(state = {}, action): EdgePluginMap<SwapSettings> {
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

  userSettings(state = {}, action): EdgePluginMap<object> {
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

export const accountReducer = filterReducer<
  AccountState,
  RootAction,
  AccountNext,
  RootAction
>(accountInner, (action, next) => {
  if (
    /^ACCOUNT_/.test(action.type) &&
    'payload' in action &&
    typeof action.payload === 'object' &&
    'accountId' in action.payload &&
    action.payload.accountId === next.id
  ) {
    return action
  }

  if (action.type === 'LOGIN' && next.root.lastAccountId === next.id) {
    return action
  }

  return { type: 'UPDATE_NEXT' }
})

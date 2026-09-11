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
  readonly bulkWalletSeedPending: boolean
  readonly keysLoaded: boolean
  readonly legacyWalletInfos: EdgeWalletInfo[]
  readonly walletInfos: WalletInfoFullMap
  readonly walletStates: EdgeWalletStates
  readonly walletStatesDirtyIds: string[]
  readonly walletStatesLoaded: boolean
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
  readonly configOtherMethodNames: EdgePluginMap<string[]>
  readonly customTokens: EdgePluginMap<EdgeTokenMap>
  readonly customTokensDirtyIds: EdgePluginMap<string[]>
  readonly customTokensLoaded: boolean
  readonly alwaysEnabledTokenIds: EdgePluginMap<string[]>
  readonly swapSettings: EdgePluginMap<SwapSettings>
  readonly swapSettingsDirtyIds: string[]
  readonly userSettings: EdgePluginMap<object>
  readonly userSettingsDirtyIds: string[]
  readonly pluginSettingsLoaded: boolean
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
    return action.type === 'ACCOUNT_KEYS_LOADED' ||
      action.type === 'ACCOUNT_CACHE_LOADED'
      ? true
      : state
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

  walletStates(state = {}, action, next, prev): EdgeWalletStates {
    switch (action.type) {
      case 'ACCOUNT_CACHE_LOADED':
      case 'ACCOUNT_CHANGED_WALLET_STATES':
        return action.payload.walletStates

      case 'ACCOUNT_KEYS_LOADED': {
        // User changes made while this load was reading the disk win
        // over the values the load saw (the disk already has them,
        // since `changeWalletStates` writes before it dispatches):
        const dirtyIds = prev.self?.walletStatesDirtyIds ?? []
        if (dirtyIds.length === 0) return action.payload.walletStates

        const out = { ...action.payload.walletStates }
        for (const id of dirtyIds) {
          if (state[id] != null) out[id] = state[id]
        }
        return out
      }
    }
    return state
  },

  walletStatesDirtyIds(state = [], action): string[] {
    switch (action.type) {
      case 'ACCOUNT_CHANGED_WALLET_STATES':
        return [...state, ...action.payload.changedIds]

      case 'ACCOUNT_KEYS_LOADED':
        // The load has landed, and `walletStates` merged these ids:
        return state.length === 0 ? state : []
    }
    return state
  },

  walletStatesLoaded(state = false, action): boolean {
    return action.type === 'ACCOUNT_KEYS_LOADED' ? true : state
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
    (stashTree, sessionKey): LoginTree => {
      const loginTree = makeLoginTree(stashTree, sessionKey)
      return loginTree
    }
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
    action,
    next,
    prev
  ): EdgePluginMap<EdgeTokenMap> {
    switch (action.type) {
      case 'ACCOUNT_CACHE_LOADED': {
        const { customTokens } = action.payload
        return customTokens
      }
      case 'ACCOUNT_CUSTOM_TOKENS_LOADED': {
        // Unsaved user edits win over the file we just loaded, but
        // only for the token ids the user actually touched - the
        // rest of the file may hold changes from another device.
        // The edits stay dirty, so the tokenSaver writes them out:
        const { customTokens } = action.payload
        const dirtyIds = prev.self?.customTokensDirtyIds ?? {}
        const dirtyPluginIds = Object.keys(dirtyIds).filter(
          pluginId => dirtyIds[pluginId].length > 0
        )
        if (dirtyPluginIds.length === 0) return customTokens

        const out = { ...customTokens }
        for (const pluginId of dirtyPluginIds) {
          const dirty = dirtyIds[pluginId]
          const loaded = out[pluginId] ?? {}
          const list: EdgeTokenMap = {}
          for (const tokenId of Object.keys(loaded)) {
            // A dirty id missing from our state was removed here:
            if (dirty.includes(tokenId) && state[pluginId]?.[tokenId] == null) {
              continue
            }
            list[tokenId] = loaded[tokenId]
          }
          for (const tokenId of dirty) {
            const token = state[pluginId]?.[tokenId]
            if (token != null) list[tokenId] = token
          }
          out[pluginId] = list
        }
        return out
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

  configOtherMethodNames(state = {}, action): EdgePluginMap<string[]> {
    // Cached plugin method names; the live plugin list wins whenever
    // the plugins are loaded, so this only fills gaps:
    return action.type === 'ACCOUNT_CACHE_LOADED'
      ? action.payload.configOtherMethodNames
      : state
  },

  customTokensDirtyIds(
    state = {},
    action,
    next,
    prev
  ): EdgePluginMap<string[]> {
    switch (action.type) {
      case 'ACCOUNT_CUSTOM_TOKEN_ADDED':
      case 'ACCOUNT_CUSTOM_TOKEN_REMOVED': {
        // These actions might change the token list, so check for diffs:
        if (next.self.customTokens === prev.self?.customTokens) return state
        const { pluginId, tokenId } = action.payload
        const ids = state[pluginId] ?? []
        if (ids.includes(tokenId)) return state
        return { ...state, [pluginId]: [...ids, tokenId] }
      }

      case 'ACCOUNT_CUSTOM_TOKENS_SAVED':
        // The edits are on disk, so a future load will include them:
        return Object.keys(state).length === 0 ? state : {}
    }
    return state
  },

  customTokensLoaded(state = false, action): boolean {
    return action.type === 'ACCOUNT_CUSTOM_TOKENS_LOADED' ? true : state
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

  swapSettings(state = {}, action, next, prev): EdgePluginMap<SwapSettings> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED': {
        // User changes win over the file we just loaded, but only
        // for the plugin ids the user actually touched - the rest of
        // the file may hold changes from another device. The changes
        // wrote the file before dispatching, so nothing is unsaved:
        const dirtyIds = prev.self?.swapSettingsDirtyIds ?? []
        if (dirtyIds.length === 0) return action.payload.swapSettings
        const out = { ...action.payload.swapSettings }
        for (const pluginId of dirtyIds) {
          if (state[pluginId] != null) out[pluginId] = state[pluginId]
        }
        return out
      }

      case 'ACCOUNT_SWAP_SETTINGS_CHANGED': {
        const { pluginId, swapSettings } = action.payload
        const out = { ...state }
        out[pluginId] = swapSettings
        return out
      }
    }
    return state
  },

  userSettings(state = {}, action, next, prev): EdgePluginMap<object> {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_CHANGED': {
        const { pluginId, userSettings } = action.payload
        const out = { ...state }
        out[pluginId] = userSettings
        return out
      }

      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED': {
        // User changes win over the file we just loaded, but only
        // for the plugin ids the user actually touched - the rest of
        // the file may hold changes from another device. The changes
        // wrote the file before dispatching, so nothing is unsaved:
        const dirtyIds = prev.self?.userSettingsDirtyIds ?? []
        if (dirtyIds.length === 0) return action.payload.userSettings
        const out = { ...action.payload.userSettings }
        for (const pluginId of dirtyIds) {
          if (state[pluginId] != null) out[pluginId] = state[pluginId]
        }
        return out
      }
    }
    return state
  },

  pluginSettingsLoaded(state = false, action): boolean {
    return action.type === 'ACCOUNT_PLUGIN_SETTINGS_LOADED' ? true : state
  },

  swapSettingsDirtyIds(state = [], action): string[] {
    switch (action.type) {
      case 'ACCOUNT_SWAP_SETTINGS_CHANGED': {
        const { pluginId } = action.payload
        return state.includes(pluginId) ? state : [...state, pluginId]
      }

      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        // The load has landed, and `swapSettings` merged these ids:
        return state.length === 0 ? state : []
    }
    return state
  },

  userSettingsDirtyIds(state = [], action): string[] {
    switch (action.type) {
      case 'ACCOUNT_PLUGIN_SETTINGS_CHANGED': {
        const { pluginId } = action.payload
        return state.includes(pluginId) ? state : [...state, pluginId]
      }

      case 'ACCOUNT_PLUGIN_SETTINGS_LOADED':
        // The load has landed, and `userSettings` merged these ids:
        return state.length === 0 ? state : []
    }
    return state
  },

  bulkWalletSeedPending(state = false, action): boolean {
    switch (action.type) {
      case 'ACCOUNT_CACHE_LOADED':
        // The account pixie's bulk loader is about to read every
        // wallet's cache files and seed them in a single dispatch;
        // wallet pixies hold their own fallback reads until then:
        return true

      case 'CURRENCY_WALLETS_CACHE_LOADED':
        return false

      case 'ACCOUNT_KEYS_LOADED':
        // Backstop: if the bulk loader somehow died, the authoritative
        // load unwedges the wallet pixies (they fall back to their own
        // reads):
        return false

      case 'ACCOUNT_LOAD_FAILED':
        // The deferred load gave up, so the bulk seed is never coming.
        // Clear the hold so the wallet pixies fall back to their own
        // cache reads instead of wedging (never starting an engine or
        // emitting an API object) for the life of the session:
        return false
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
    (/^ACCOUNT_/.test(action.type) ||
      action.type === 'CURRENCY_WALLETS_CACHE_LOADED') &&
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

import { buildReducer, mapReducer } from 'redux-keto'

import { EdgeLogSettings } from './../types/types'
import { accountReducer, AccountState } from './account/account-reducer'
import { RootAction } from './actions'
import { contextConfig, ContextConfigState } from './context/context-reducer'
import { currency, CurrencyState } from './currency/currency-reducer'
import { login, LoginState } from './login/login-reducer'
import { plugins, PluginsState } from './plugins/plugins-reducer'
import { storageWallets, StorageWalletsState } from './storage/storage-reducer'

export interface RootState {
  readonly accountCount: number
  readonly accountIds: string[]
  readonly accounts: { [accountId: string]: AccountState }
  readonly hideKeys: boolean
  readonly lastAccountId: string
  readonly logSettings: EdgeLogSettings
  readonly paused: boolean
  readonly ready: boolean
  readonly skipBlockHeight: boolean

  // Children reducers:
  readonly contextConfig: ContextConfigState
  readonly currency: CurrencyState
  readonly login: LoginState
  readonly plugins: PluginsState
  readonly storageWallets: StorageWalletsState
}

export const defaultLogSettings: EdgeLogSettings = {
  sources: {},
  defaultLogLevel: 'warn'
}

export const reducer = buildReducer<RootState, RootAction, RootState>({
  accountCount(state = 0, action): number {
    return action.type === 'LOGIN' ? state + 1 : state
  },

  accountIds(state = [], action, next): string[] {
    switch (action.type) {
      case 'LOGIN':
        return [...state, next.lastAccountId]

      case 'LOGOUT': {
        const { accountId } = action.payload
        const out = state.filter(id => id !== accountId)
        if (out.length === state.length) {
          throw new Error(`Login ${accountId} does not exist`)
        }
        return out
      }

      case 'CLOSE':
        return []
    }
    return state
  },

  accounts: mapReducer(accountReducer, next => next.accountIds),

  hideKeys(state = true, action): boolean {
    return action.type === 'INIT' ? action.payload.hideKeys : state
  },

  lastAccountId(state, action, next): string {
    return `login${next.accountCount}`
  },

  logSettings(state = defaultLogSettings, action): EdgeLogSettings {
    switch (action.type) {
      case 'INIT':
        return action.payload.logSettings
      case 'CHANGE_LOG_SETTINGS':
        return action.payload
    }
    return state
  },

  paused(state = false, action): boolean {
    return action.type === 'PAUSE' ? action.payload : state
  },

  ready(state = false, action): boolean {
    return action.type === 'INIT' ? true : state
  },

  skipBlockHeight(state = false, action): boolean {
    return action.type === 'INIT' ? action.payload.skipBlockHeight : state
  },

  contextConfig,
  currency,
  login,
  plugins,
  storageWallets
})

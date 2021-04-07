// @flow

import { type BuiltReducer, buildReducer, mapReducer } from 'redux-keto'

import { type EdgeLogSettings, type EdgeRateHint } from './../types/types.js'
import { type AccountState, accountReducer } from './account/account-reducer.js'
import { type RootAction } from './actions.js'
import { type CurrencyState, currency } from './currency/currency-reducer.js'
import { DEFAULT_RATE_HINTS } from './exchange/exchange-pixie'
import {
  type ExchangeState,
  exchangeCache
} from './exchange/exchange-reducer.js'
import { type LoginState, login } from './login/login-reducer.js'
import { type PluginsState, plugins } from './plugins/plugins-reducer.js'
import {
  type StorageWalletsState,
  storageWallets
} from './storage/storage-reducer.js'

export type RootState = {
  +accountCount: number,
  +accountIds: string[],
  +accounts: { [accountId: string]: AccountState },
  +hideKeys: boolean,
  +lastAccountId: string,
  +logSettings: EdgeLogSettings,
  +paused: boolean,
  +rateHintCache: EdgeRateHint[],
  +ready: boolean,

  // Children reducers:
  +currency: CurrencyState,
  +exchangeCache: ExchangeState,
  +login: LoginState,
  +plugins: PluginsState,
  +storageWallets: StorageWalletsState
}

export const defaultLogSettings: EdgeLogSettings = {
  sources: {},
  defaultLogLevel: 'warn'
}

export const reducer: BuiltReducer<RootState, RootAction> = buildReducer({
  accountCount(state = 0, action: RootAction): number {
    return action.type === 'LOGIN' ? state + 1 : state
  },

  accountIds(state = [], action: RootAction, next: RootState): string[] {
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

  accounts: mapReducer(accountReducer, (next: RootState) => next.accountIds),

  hideKeys(state = true, action: RootAction): boolean {
    return action.type === 'INIT' ? action.payload.hideKeys : state
  },

  lastAccountId(state, action: RootAction, next: RootState): string {
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

  paused(state = false, action: RootAction): boolean {
    return action.type === 'PAUSE' ? action.payload : state
  },

  rateHintCache(state = DEFAULT_RATE_HINTS, action): EdgeRateHint[] {
    switch (action.type) {
      case 'INIT':
      case 'UPDATE_RATE_HINT_CACHE':
        return action.payload.rateHintCache
    }
    return state
  },

  ready(state = false, action: RootAction): boolean {
    return action.type === 'INIT' ? true : state
  },

  currency,
  exchangeCache,
  login,
  plugins,
  storageWallets
})

// @flow

import { buildReducer, mapReducer } from 'redux-keto'

import { type AccountState, accountReducer } from './account/account-reducer.js'
import { type RootAction } from './actions.js'
import { type CurrencyState, currency } from './currency/currency-reducer.js'
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
  +accountIds: Array<string>,
  +accounts: { [accountId: string]: AccountState },
  +hideKeys: boolean,
  +lastAccountId: string,

  +currency: CurrencyState,
  +exchangeCache: ExchangeState,
  +login: LoginState,
  +plugins: PluginsState,
  +storageWallets: StorageWalletsState
}

export const reducer = buildReducer({
  accountCount (state = 0, action: RootAction): number {
    return action.type === 'LOGIN' ? state + 1 : state
  },

  accountIds (state = [], action: RootAction, next: RootState): Array<string> {
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

  hideKeys (state = true, action: RootAction): boolean {
    return action.type === 'INIT' ? action.payload.hideKeys : state
  },

  lastAccountId (state, action: RootAction, next: RootState): string {
    return 'login' + next.accountCount.toString()
  },

  currency,
  exchangeCache,
  login,
  plugins,
  storageWallets
})

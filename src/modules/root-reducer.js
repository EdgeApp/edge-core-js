// @flow

import { buildReducer, mapReducer } from 'redux-keto'

import accountReducer, { type AccountState } from './account/account-reducer.js'
import { type RootAction } from './actions.js'
import currency, { type CurrencyState } from './currency/currency-reducer.js'
import exchangeCache, {
  type ExchangeState
} from './exchange/exchange-reducer.js'
import login, { type LoginState } from './login/login-reducer.js'
import storageWallets, {
  type StorageWalletsState
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
  +storageWallets: StorageWalletsState
}

export default buildReducer({
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
    }
    return state
  },

  accounts: mapReducer(accountReducer, (next: RootState) => next.accountIds),

  hideKeys (state = true, action: RootAction): boolean {
    return action.type === 'INIT' ? action.payload.hideKeys : state
  },

  lastAccountId (state, action, next: RootState): string {
    return 'login' + next.accountCount.toString()
  },

  currency,
  exchangeCache,
  login,
  storageWallets
})

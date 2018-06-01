// @flow

import { buildReducer } from 'redux-keto'

import type { CurrencyState } from './currency/currency-reducer.js'
import currency from './currency/currency-reducer.js'
import exchangeCache from './exchange/exchange-reducer.js'
import type { ExchangeState } from './exchange/exchange-reducer.js'
import type { LoginState } from './login/login-reducer.js'
import login from './login/login-reducer.js'
import storageWallets from './storage/storage-reducer.js'
import type { StorageWalletsState } from './storage/storage-reducer.js'

export interface RootState {
  currency: CurrencyState;
  exchangeCache: ExchangeState;
  login: LoginState;
  storageWallets: StorageWalletsState;
}

export default buildReducer({
  currency,
  exchangeCache,
  login,
  storageWallets
})

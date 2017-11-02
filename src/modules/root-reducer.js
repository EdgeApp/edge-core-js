// @flow
import { buildReducer } from 'redux-keto'

import type { EdgeIo } from '../edge-core-index.js'
import type { RootAction } from './actions.js'
import type { CurrencyState } from './currency/currency-reducer.js'
import currency from './currency/currency-reducer.js'
import exchangeCache from './exchange/reducer.js'
import type { LoginState } from './login/login-reducer.js'
import login from './login/login-reducer.js'
import storageWallets from './storage/reducer.js'
import type { StorageWalletState } from './storage/reducer.js'

export interface RootState {
  currency: CurrencyState;
  io: EdgeIo;
  login: LoginState;
  storageWallets: { [walletId: string]: StorageWalletState };
}

function io (state = {}, action: RootAction) {
  return action.type === 'INIT' ? action.payload.io : state
}

export default buildReducer({
  currency,
  exchangeCache,
  io,
  login,
  storageWallets
})

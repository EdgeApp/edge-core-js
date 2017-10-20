// @flow
import type { AbcCurrencyPlugin } from 'airbitz-core-types'
import { buildReducer } from 'redux-keto'
import type { FixedIo } from '../io/fixIo.js'
import type { RootAction } from './actions.js'
import type { CurrencyState } from './currency/currency-reducer.js'
import currency from './currency/currency-reducer.js'
import currencyWallets from './currencyWallets/reducer.js'
import exchangeCache from './exchange/reducer.js'
import type { LoginState } from './login/login-reducer.js'
import login from './login/login-reducer.js'
import scrypt from './scrypt/reducer.js'
import storageWallets from './storage/reducer.js'

export interface RootState {
  currency: CurrencyState;
  io: FixedIo;
  login: LoginState;
  onError: (e: Error) => void;
  plugins: {
    currencyPlugins: Array<AbcCurrencyPlugin>
  };
  currencyWallets: {
    [walletId: string]: {
      engine: any,
      name: string
    }
  };
}

function io (state = {}, action: RootAction) {
  return action.type === 'INIT' ? action.payload.io : state
}

function onError (state = () => {}, action: RootAction) {
  return action.type === 'INIT' ? action.payload.onError : state
}

export default buildReducer({
  currencyWallets,
  currency,
  exchangeCache,
  io,
  login,
  onError,
  scrypt,
  storageWallets
})

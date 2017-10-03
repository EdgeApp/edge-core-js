// @flow
import type { AbcCurrencyPlugin } from 'airbitz-core-types'
import { combineReducers } from 'redux'
import type { FixedIo } from '../io/fixIo.js'
import type { RootAction } from './actions.js'
import * as ACTIONS from './actions.js'
import currencyWallets from './currencyWallets/reducer.js'
import exchangeCache from './exchange/reducer.js'
import type { LoginState } from './login/login-reducer.js'
import login from './login/login-reducer.js'
import plugins from './plugins/reducer.js'
import scrypt from './scrypt/reducer.js'
import storageWallets from './storage/reducer.js'

function io (state = {}, action: RootAction) {
  return action.type === ACTIONS.INIT ? action.payload.io : state
}

function onError (state = () => {}, action: RootAction) {
  return action.type === ACTIONS.INIT ? action.payload.onError : state
}

export default combineReducers({
  currencyWallets,
  exchangeCache,
  io,
  login,
  onError,
  plugins,
  scrypt,
  storageWallets
})

export interface RootState {
  io: FixedIo,
  login: LoginState,
  onError: (e: Error) => void,
  plugins: {
    currencyPlugins: Array<AbcCurrencyPlugin>
  }
}

// @flow
import type { AbcCurrencyPlugin } from 'airbitz-core-types'
import { combineReducers } from 'redux'
import type { FixedIo } from '../io/fixIo.js'
import currencyWallets from './currencyWallets/reducer.js'
import exchangeCache from './exchange/reducer.js'
import plugins from './plugins/reducer.js'
import scrypt from './scrypt/reducer.js'
import storageWallets from './storage/reducer.js'

export const INIT = 'airbitz-core-js/INIT'

/**
 * Initializes the redux store on context creation.
 */
export function initStore (io: FixedIo, onError: (e: Error) => void) {
  return { type: INIT, payload: { io, onError } }
}

function io (state = {}, action) {
  return action.type === INIT ? action.payload.io : state
}

function onError (state = () => {}, action) {
  return action.type === INIT ? action.payload.onError : state
}

export default combineReducers({
  // Library state:
  io,
  onError,
  plugins,
  scrypt,

  // Exchanges:
  exchangeCache,

  // Wallet state:
  currencyWallets,
  storageWallets
})

export interface RootState {
  io: FixedIo,
  onError: (e: Error) => void,
  plugins: {
    currencyPlugins: Array<AbcCurrencyPlugin>
  }
}

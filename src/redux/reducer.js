import currencyWallets from './currencyWallets/reducer.js'
import exchangeCache from './exchangeCache/reducer.js'
import plugins from './plugins/reducer.js'
import scrypt from './scrypt/reducer.js'
import storageWallets from './storageWallets/reducer.js'
import { combineReducers } from 'redux'

export const INIT = 'airbitz-core-js/INIT'

/**
 * Initializes the redux store on context creation.
 */
export function initStore (io, onError) {
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

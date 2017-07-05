import { INIT } from './actions.js'
import currencyWallets from './currencyWallets/reducer.js'
import exchangeCache from './exchangeCache/reducer.js'
import plugins from './plugins/reducer.js'
import storageWallets from './storageWallets/reducer.js'
import { combineReducers } from 'redux'

function io (state = {}, action) {
  return action.type === INIT ? action.payload.io : state
}

export default combineReducers({
  // Library state:
  io,
  plugins,

  // Exchanges:
  exchangeCache,

  // Wallet state:
  currencyWallets,
  storageWallets
})

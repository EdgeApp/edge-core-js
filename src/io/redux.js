import currencyWallets from '../currencyWallets/reducer.js'
import { reactionMiddleware } from '../util/reaction.js'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import thunk from 'redux-thunk'

export function makeRedux () {
  const reducer = combineReducers({
    currencyWallets
  })

  return createStore(reducer, applyMiddleware(thunk, reactionMiddleware))
}

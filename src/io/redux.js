import { reduxSource } from '../util/derive.js'
import { applyMiddleware, combineReducers, compose, createStore } from 'redux'
import thunk from 'redux-thunk'

export function makeRedux () {
  const reducer = combineReducers({
    // Add slices here
    x: (state = {}) => state
  })

  return createStore(
    reducer,
    void 0,
    compose(applyMiddleware(thunk), reduxSource())
  )
}

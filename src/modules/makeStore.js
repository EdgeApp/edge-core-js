// @flow
import { applyMiddleware, compose, createStore } from 'redux'
import thunk from 'redux-thunk'

import { reactionMiddleware } from '../util/redux/reaction.js'
import reducer from './root-reducer.js'

const composeEnhancers =
  typeof window === 'object' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'core' })
    : compose

export function makeStore () {
  return createStore(
    reducer,
    composeEnhancers(applyMiddleware(thunk, reactionMiddleware))
  )
}

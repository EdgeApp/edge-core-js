// @flow

import { applyMiddleware, compose, createStore } from 'redux'
import type { StoreEnhancer } from 'redux'

import { reactionMiddleware } from '../util/redux/reaction.js'
import type { RootAction } from './actions.js'
import reducer from './root-reducer.js'
import type { RootState } from './root-reducer.js'

const composeEnhancers =
  typeof window === 'object' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name: 'core' })
    : compose

export function makeStore () {
  const enhancers: StoreEnhancer<RootState, RootAction> = composeEnhancers(
    applyMiddleware(reactionMiddleware)
  )
  return createStore(reducer, enhancers)
}

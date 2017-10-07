import { applyMiddleware, createStore } from 'redux'
import thunk from 'redux-thunk'
import { reactionMiddleware } from '../util/redux/reaction.js'
import reducer from './rootReducer.js'

export function makeStore () {
  return createStore(reducer, applyMiddleware(thunk, reactionMiddleware))
}

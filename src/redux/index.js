import { reactionMiddleware } from '../util/redux/reaction.js'
import reducer from './reducer.js'
import { applyMiddleware, createStore } from 'redux'
import thunk from 'redux-thunk'

export function makeStore () {
  return createStore(reducer, applyMiddleware(thunk, reactionMiddleware))
}

// @flow

import { type Reducer, combineReducers } from 'redux'

import { type RootAction } from '../../actions.js'

export type LoginServerState = {
  +apiKey: string,
  +uri: string
}

export const server: Reducer<LoginServerState, RootAction> = combineReducers({
  apiKey (state = '', action: RootAction): string {
    return action.type === 'INIT' ? action.payload.apiKey : state
  },

  uri (state = '', action: RootAction): string {
    return action.type === 'INIT' ? action.payload.authServer : state
  }
})

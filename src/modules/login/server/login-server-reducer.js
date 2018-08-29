// @flow

import { combineReducers } from 'redux'

import type { RootAction } from '../../actions.js'

export type LoginServerState = {
  +apiKey: string | null,
  +uri: string
}

export default combineReducers({
  apiKey (state = null, action: RootAction): string | null {
    return action.type === 'INIT' && action.payload.apiKey
      ? action.payload.apiKey
      : state
  },

  uri (state = 'https://auth.airbitz.co/api', action: RootAction): string {
    return action.type === 'INIT' && action.payload.authServer
      ? action.payload.authServer
      : state
  }
})

// @flow

import { combineReducers } from 'redux'

import type { RootAction } from '../../actions.js'

export interface LoginServerState {
  apiKey: string | null;
  uri: string;
}

export default combineReducers({
  apiKey (state: string | null = null, action: RootAction): string | null {
    return action.type === 'INIT' && action.payload.apiKey
      ? action.payload.apiKey
      : state
  },

  uri (
    state: string = 'https://auth.airbitz.co/api',
    action: RootAction
  ): string {
    return action.type === 'INIT' && action.payload.authServer
      ? action.payload.authServer
      : state
  }
})

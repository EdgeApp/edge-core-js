// @flow
import { combineReducers } from 'redux'
import type { RootAction } from '../actions.js'
import * as ACTIONS from '../actions.js'
import server from './server/login-server-reducer.js'
import type { LoginServerState } from './server/login-server-reducer.js'

export interface LoginState {
  appId: string,
  server: LoginServerState
}

export default combineReducers({
  appId (state: string = '', action: RootAction) {
    return action.type === ACTIONS.INIT && action.payload.appId
      ? action.payload.appId
      : state
  },

  server
})

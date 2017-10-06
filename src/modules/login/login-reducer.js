// @flow
import { buildReducer, mapReducer } from 'redux-keto'
import type { RootAction } from '../actions.js'
import * as ACTIONS from '../actions.js'
import type { RootState } from '../rootReducer.js'
import activeLogin from './active/active-login-reducer.js'
import type { ActiveLoginState } from './active/active-login-reducer.js'
import server from './server/login-server-reducer.js'
import type { LoginServerState } from './server/login-server-reducer.js'

export interface LoginState {
  activeLoginIds: Array<string>,
  appId: string,
  lastActiveLoginId: string,
  loginCount: number,
  logins: { [index: string]: ActiveLoginState },
  server: LoginServerState
}

export default buildReducer({
  appId (state: string = '', action: RootAction) {
    return action.type === ACTIONS.INIT && action.payload.appId
      ? action.payload.appId
      : state
  },

  loginCount (state: number = 0, action: RootAction) {
    return action.type === ACTIONS.LOGIN ? state + 1 : state
  },

  lastActiveLoginId (state, action, next: RootState) {
    return 'login' + next.login.loginCount.toString()
  },

  activeLoginIds (
    state: Array<string> = [],
    action: RootAction,
    next: RootState
  ): Array<string> {
    switch (action.type) {
      case ACTIONS.LOGIN:
        return [...state, next.login.lastActiveLoginId]

      case ACTIONS.LOGOUT: {
        const { activeLoginId } = action.payload
        const out = state.filter(id => id !== activeLoginId)
        if (out.length === state.length) {
          throw new Error(`Login ${activeLoginId} does not exist`)
        }
        return out
      }
    }
    return state
  },

  logins: mapReducer(
    activeLogin,
    (next: RootState) => next.login.activeLoginIds,
    (next, peers, id) => ({ state: next, id })
  ),

  server
})

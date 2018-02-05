// @flow

import { buildReducer, mapReducer } from 'redux-keto'

import type { RootAction } from '../actions.js'
import type { RootState } from '../root-reducer.js'
import activeLoginReducer from './active/active-login-reducer.js'
import type { ActiveLoginState } from './active/active-login-reducer.js'
import type { WalletInfoMap } from './login-types.js'
import server from './server/login-server-reducer.js'
import type { LoginServerState } from './server/login-server-reducer.js'

export interface LoginState {
  activeLoginIds: Array<string>;
  appId: string;
  lastActiveLoginId: string;
  loginCount: number;
  logins: { [index: string]: ActiveLoginState };
  server: LoginServerState;
  walletInfos: WalletInfoMap;
}

export default buildReducer({
  appId (state: string = '', action: RootAction) {
    return action.type === 'INIT' && action.payload.appId
      ? action.payload.appId
      : state
  },

  loginCount (state: number = 0, action: RootAction) {
    return action.type === 'LOGIN' ? state + 1 : state
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
      case 'LOGIN':
        return [...state, next.login.lastActiveLoginId]

      case 'LOGOUT': {
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
    activeLoginReducer,
    (next: RootState) => next.login.activeLoginIds
  ),

  server,

  walletInfos (state, action, next: RootState) {
    // Optimize the common case:
    if (next.login.activeLoginIds.length === 1) {
      const id = next.login.activeLoginIds[0]
      return next.login.logins[id].allWalletInfos
    }

    const out = {}
    for (const activeLoginId of next.login.activeLoginIds) {
      const login = next.login.logins[activeLoginId]
      for (const id of Object.keys(login.allWalletInfos)) {
        const info = login.allWalletInfos[id]
        out[id] = info
      }
    }
    return out
  }
})

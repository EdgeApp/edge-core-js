// @flow

import { buildReducer } from 'redux-keto'

import type { RootAction } from '../actions.js'
import type { RootState } from '../root-reducer.js'
import type { WalletInfoMap } from './login-types.js'
import server from './server/login-server-reducer.js'
import type { LoginServerState } from './server/login-server-reducer.js'

export type LoginState = {
  +appId: string,
  +server: LoginServerState,
  +walletInfos: WalletInfoMap
}

export default buildReducer({
  appId (state = '', action: RootAction): string {
    return action.type === 'INIT' && action.payload.appId
      ? action.payload.appId
      : state
  },

  server,

  walletInfos (state, action, next: RootState): WalletInfoMap {
    // Optimize the common case:
    if (next.accountIds.length === 1) {
      const id = next.accountIds[0]
      return next.accounts[id].allWalletInfos
    }

    const out = {}
    for (const accountId of next.accountIds) {
      const login = next.accounts[accountId]
      for (const id of Object.keys(login.allWalletInfos)) {
        const info = login.allWalletInfos[id]
        out[id] = info
      }
    }
    return out
  }
})

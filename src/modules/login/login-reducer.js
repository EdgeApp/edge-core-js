// @flow

import { buildReducer } from 'redux-keto'

import type { RootAction } from '../actions.js'
import type { RootState } from '../root-reducer.js'
import type { LoginStash, WalletInfoMap } from './login-types.js'
import server from './server/login-server-reducer.js'
import type { LoginServerState } from './server/login-server-reducer.js'

export type LoginStashMap = { [username: string]: LoginStash }

export type LoginState = {
  +appId: string,
  +server: LoginServerState,
  +stashes: LoginStashMap,
  +stashesLoaded: boolean,
  +walletInfos: WalletInfoMap
}

export default buildReducer({
  appId (state = '', action: RootAction): string {
    return action.type === 'INIT' && action.payload.appId
      ? action.payload.appId
      : state
  },

  server,

  stashes (state = {}, action: RootAction): LoginStashMap {
    switch (action.type) {
      case 'LOGIN_STASH_DELETED': {
        const copy = { ...state }
        delete copy[action.payload]
        return copy
      }

      case 'LOGIN_STASHES_LOADED': {
        const out: LoginStashMap = {}

        // Extract the usernames from the top-level objects:
        for (const filename of Object.keys(action.payload)) {
          const json = action.payload[filename]
          if (json && json.username && json.loginId) {
            const { username } = json
            out[username] = json
          }
        }

        return out
      }

      case 'LOGIN_STASH_SAVED': {
        const { username } = action.payload
        if (!username) throw new Error('Missing username')

        const out = { ...state }
        out[username] = action.payload
        return out
      }
    }
    return state
  },

  stashesLoaded (state = false, action: RootAction): boolean {
    return action.type === 'LOGIN_STASHES_LOADED' ? true : state
  },

  walletInfos (state, action, next: RootState): WalletInfoMap {
    // Optimize the common case:
    if (next.accountIds.length === 1) {
      const id = next.accountIds[0]
      return next.accounts[id].walletInfos
    }

    const out = {}
    for (const accountId of next.accountIds) {
      const account = next.accounts[accountId]
      for (const id of Object.keys(account.walletInfos)) {
        const info = account.walletInfos[id]
        out[id] = info
      }
    }
    return out
  }
})

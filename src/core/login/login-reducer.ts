import { buildReducer, memoizeReducer } from 'redux-keto'

import { EdgeUserInfo } from '../../types/types'
import { verifyData } from '../../util/crypto/verify'
import { base58 } from '../../util/encoding'
import { RootAction } from '../actions'
import { RootState } from '../root-reducer'
import { searchTree } from './login'
import { LoginStash } from './login-stash'
import { WalletInfoFullMap } from './login-types'
import { findPin2Stash, findPin2StashDuress } from './pin2'

export interface LoginState {
  readonly apiKey: string
  readonly apiSecret: Uint8Array | null
  readonly contextAppId: string
  readonly deviceDescription: string | null
  readonly loginServers: string[]
  readonly stashes: LoginStash[]
  readonly localUsers: EdgeUserInfo[]
  readonly walletInfos: WalletInfoFullMap
}

export const login = buildReducer<LoginState, RootAction, RootState>({
  apiKey(state = '', action): string {
    return action.type === 'INIT' ? action.payload.apiKey : state
  },

  apiSecret(state = null, action): Uint8Array | null {
    return action.type === 'INIT' ? action.payload.apiSecret ?? null : state
  },

  contextAppId(state = '', action): string {
    return action.type === 'INIT' ? action.payload.appId : state
  },

  deviceDescription(state = null, action): string | null {
    return action.type === 'INIT' ? action.payload.deviceDescription : state
  },

  localUsers: memoizeReducer(
    (next: RootState) => next.login.contextAppId,
    (next: RootState) => next.login.stashes,
    (next: RootState) => next.clientInfo,
    (appId, stashes, clientInfo): EdgeUserInfo[] => {
      function processStash(stashTree: LoginStash): EdgeUserInfo {
        const { lastLogin, loginId, recovery2Key, username } = stashTree

        const stash = searchTree(stashTree, stash => stash.appId === appId)
        const keyLoginEnabled =
          stash != null &&
          (stash.passwordAuthBox != null || stash.loginAuthBox != null)

        // This allows us to lie about PIN being enabled or disabled while in
        // duress mode!
        const pin2Stash = clientInfo.duressEnabled
          ? findPin2StashDuress(stashTree, appId)
          : findPin2Stash(stashTree, appId)

        return {
          keyLoginEnabled,
          lastLogin,
          loginId: base58.stringify(loginId),
          pinLoginEnabled: pin2Stash != null,
          recovery2Key:
            recovery2Key != null ? base58.stringify(recovery2Key) : undefined,
          username,
          voucherId: stash != null ? stash.voucherId : undefined
        }
      }

      return stashes.map(processStash)
    }
  ),

  loginServers(state = [], action): string[] {
    return action.type === 'INIT' ? action.payload.loginServers : state
  },

  stashes(state = [], action): LoginStash[] {
    switch (action.type) {
      case 'INIT': {
        return action.payload.stashes
      }

      case 'LOGIN_STASH_DELETED': {
        const loginId = action.payload
        return state.filter(
          stashTree => !verifyData(stashTree.loginId, loginId)
        )
      }

      case 'LOGIN_STASH_SAVED': {
        const newStashTree = action.payload
        const out = state.filter(
          stashTree => !verifyData(stashTree.loginId, newStashTree.loginId)
        )
        out.unshift(newStashTree)
        return out
      }
    }
    return state
  },

  walletInfos(state, action, next: RootState): WalletInfoFullMap {
    // Optimize the common case:
    if (next.accountIds.length === 1) {
      const id = next.accountIds[0]
      return next.accounts[id].walletInfos
    }

    const out: WalletInfoFullMap = {}
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

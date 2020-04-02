// @flow

import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { checkPasswordRules, fixUsername } from '../../client-side.js'
import {
  type EdgeAccount,
  type EdgeAccountOptions,
  type EdgeContext,
  type EdgeEdgeLoginOptions,
  type EdgeLoginMessages,
  type EdgePendingEdgeLogin,
  type EdgeUserInfo
} from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { findAppLogin, makeAccount } from '../account/account-init.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { getStash } from '../login/login-selectors.js'
import {
  fetchLoginMessages,
  makeLoginTree,
  resetOtp,
  syncLogin
} from '../login/login.js'
import { removeStash } from '../login/loginStore.js'
import { loginPassword } from '../login/password.js'
import { getPin2Key, loginPin2 } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  listRecoveryQuestionChoices,
  loginRecovery2
} from '../login/recovery2.js'
import { type ApiInput } from '../root-pixie.js'
import { EdgeInternalStuff } from './internal-api.js'

export function makeContextApi(ai: ApiInput) {
  const appId = ai.props.state.login.appId
  const $internalStuff = new EdgeInternalStuff(ai)
  let pauseTimer: TimeoutID | void

  const out: EdgeContext = {
    on: onMethod,
    watch: watchMethod,

    appId,

    async close(): Promise<void> {
      ai.props.close()
    },

    $internalStuff,

    fixUsername,

    get localUsers(): EdgeUserInfo[] {
      return ai.props.state.login.localUsers
    },

    async listUsernames(): Promise<string[]> {
      return Object.keys(ai.props.state.login.stashes)
    },

    async deleteLocalAccount(username: string): Promise<void> {
      // Safety check:
      const fixedName = fixUsername(username)
      for (const accountId of ai.props.state.accountIds) {
        if (ai.props.state.accounts[accountId].username === fixedName) {
          throw new Error('Cannot remove logged-in user')
        }
      }

      return removeStash(ai, username)
    },

    async usernameAvailable(username: string): Promise<boolean> {
      return usernameAvailable(ai, username)
    },

    async createAccount(
      username: string,
      password?: string,
      pin?: string,
      opts?: EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts == null) opts = {} // opts can be `null`, not just `undefined`

      return createLogin(ai, username, {
        password,
        pin
      }).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'newAccount', opts)
      })
    },

    async loginWithKey(
      username: string,
      loginKey: string,
      opts?: EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts == null) opts = {} // opts can be `null`, not just `undefined`

      const stashTree = getStash(ai, username)
      const loginTree = makeLoginTree(stashTree, base58.parse(loginKey), appId)

      // Since we logged in offline, update the stash in the background:
      syncLogin(ai, loginTree, findAppLogin(loginTree, appId)).catch(e =>
        ai.props.onError(e)
      )

      return makeAccount(ai, appId, loginTree, 'keyLogin', opts)
    },

    async loginWithPassword(
      username: string,
      password: string,
      opts?: EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts == null) opts = {} // opts can be `null`, not just `undefined`
      const { otp } = opts

      return loginPassword(ai, username, password, otp).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'passwordLogin', opts)
      })
    },

    checkPasswordRules,

    async pinLoginEnabled(username: string): Promise<boolean> {
      const loginStash = getStash(ai, username)
      const pin2Key = getPin2Key(loginStash, appId)
      return pin2Key && pin2Key.pin2Key != null
    },

    async loginWithPIN(
      username: string,
      pin: string,
      opts?: EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts == null) opts = {} // opts can be `null`, not just `undefined`
      const { otp } = opts

      return loginPin2(ai, appId, username, pin, otp).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'pinLogin', opts)
      })
    },

    async getRecovery2Key(username: string): Promise<string> {
      const loginStash = getStash(ai, username)
      const recovery2Key = getRecovery2Key(loginStash)
      if (recovery2Key == null) {
        throw new Error('No recovery key stored locally.')
      }
      return base58.stringify(recovery2Key)
    },

    async loginWithRecovery2(
      recovery2Key: string,
      username: string,
      answers: string[],
      opts?: EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts == null) opts = {} // opts can be `null`, not just `undefined`
      const { otp } = opts

      return loginRecovery2(
        ai,
        base58.parse(recovery2Key),
        username,
        answers,
        otp
      ).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'recoveryLogin', opts)
      })
    },

    async fetchRecovery2Questions(
      recovery2Key: string,
      username: string
    ): Promise<string[]> {
      return getQuestions2(ai, base58.parse(recovery2Key), username)
    },

    async listRecoveryQuestionChoices(): Promise<string[]> {
      return listRecoveryQuestionChoices(ai)
    },

    async requestEdgeLogin(
      opts: EdgeEdgeLoginOptions
    ): Promise<EdgePendingEdgeLogin> {
      return requestEdgeLogin(ai, appId, opts)
    },

    async requestOtpReset(
      username: string,
      otpResetToken: string
    ): Promise<Date> {
      return resetOtp(ai, username, otpResetToken)
    },

    async fetchLoginMessages(): Promise<EdgeLoginMessages> {
      return fetchLoginMessages(ai)
    },

    get paused(): boolean {
      return ai.props.state.paused
    },

    async changePaused(
      paused: boolean,
      opts: { secondsDelay?: number } = {}
    ): Promise<void> {
      const { secondsDelay = 0 } = opts

      // If a timer is already running, stop that:
      if (pauseTimer != null) {
        clearTimeout(pauseTimer)
        pauseTimer = undefined
      }

      // If the state is the same, do nothing:
      if (ai.props.state.paused === paused) return

      // Otherwise, make the change:
      if (secondsDelay === 0) {
        ai.props.dispatch({ type: 'PAUSE', payload: paused })
      } else {
        pauseTimer = setTimeout(() => {
          pauseTimer = undefined
          ai.props.dispatch({ type: 'PAUSE', payload: paused })
        }, secondsDelay * 1000)
      }
    },

    // Deprecated API's:
    pinExists(username: string): Promise<boolean> {
      return this.pinLoginEnabled(username)
    }
  }
  bridgifyObject(out)

  return out
}

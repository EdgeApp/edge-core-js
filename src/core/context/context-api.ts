import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { checkPasswordRules, fixUsername } from '../../client-side'
import {
  EdgeAccount,
  EdgeAccountOptions,
  EdgeContext,
  EdgeLoginMessages,
  EdgeLogSettings,
  EdgePendingEdgeLogin,
  EdgeRecoveryQuestionChoice,
  EdgeUserInfo
} from '../../types/types'
import { base58 } from '../../util/encoding'
import { findAppLogin, makeAccount } from '../account/account-init'
import { createLogin, usernameAvailable } from '../login/create'
import { requestEdgeLogin } from '../login/edge'
import { makeLoginTree, syncLogin } from '../login/login'
import { fetchLoginMessages } from '../login/login-messages'
import { getStash } from '../login/login-selectors'
import { removeStash, saveStash } from '../login/login-stash'
import { resetOtp } from '../login/otp'
import { loginPassword } from '../login/password'
import { findPin2Stash, loginPin2 } from '../login/pin2'
import {
  getQuestions2,
  listRecoveryQuestionChoices,
  loginRecovery2
} from '../login/recovery2'
import { ApiInput } from '../root-pixie'
import { EdgeInternalStuff } from './internal-api'

export function makeContextApi(ai: ApiInput): EdgeContext {
  const appId = ai.props.state.login.appId
  const clientId = base58.stringify(ai.props.state.login.clientId)
  const $internalStuff = new EdgeInternalStuff(ai)
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  const out: EdgeContext = {
    on: onMethod,
    watch: watchMethod,

    appId,
    clientId,

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

      return await removeStash(ai, username)
    },

    async usernameAvailable(username: string): Promise<boolean> {
      return await usernameAvailable(ai, username)
    },

    async createAccount(
      username: string,
      password?: string,
      pin?: string,
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      const loginTree = await createLogin(ai, username, opts, { password, pin })
      return await makeAccount(ai, appId, loginTree, 'newAccount', opts)
    },

    async loginWithKey(
      username: string,
      loginKey: string,
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      const { now = new Date() } = opts

      const stashTree = getStash(ai, username)
      const loginTree = makeLoginTree(stashTree, base58.parse(loginKey), appId)
      stashTree.lastLogin = now
      saveStash(ai, stashTree).catch(() => {})

      // Since we logged in offline, update the stash in the background:
      syncLogin(ai, loginTree, findAppLogin(loginTree, appId)).catch(error =>
        ai.props.onError(error)
      )

      return makeAccount(ai, appId, loginTree, 'keyLogin', opts)
    },

    async loginWithPassword(
      username: string,
      password: string,
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      const loginTree = await loginPassword(ai, username, password, opts)
      return await makeAccount(ai, appId, loginTree, 'passwordLogin', opts)
    },

    checkPasswordRules,

    async pinLoginEnabled(username: string): Promise<boolean> {
      const loginStash = getStash(ai, username)
      return findPin2Stash(loginStash, appId) != null
    },

    async loginWithPIN(
      username: string,
      pin: string,
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      const loginTree = await loginPin2(ai, appId, username, pin, opts)
      return await makeAccount(ai, appId, loginTree, 'pinLogin', opts)
    },

    async loginWithRecovery2(
      recovery2Key: string,
      username: string,
      answers: string[],
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      const loginTree = await loginRecovery2(
        ai,
        base58.parse(recovery2Key),
        username,
        answers,
        opts
      )
      return await makeAccount(ai, appId, loginTree, 'recoveryLogin', opts)
    },

    async fetchRecovery2Questions(
      recovery2Key: string,
      username: string
    ): Promise<string[]> {
      return await getQuestions2(ai, base58.parse(recovery2Key), username)
    },

    async listRecoveryQuestionChoices(): Promise<EdgeRecoveryQuestionChoice[]> {
      return await listRecoveryQuestionChoices(ai)
    },

    async requestEdgeLogin(
      opts?: EdgeAccountOptions
    ): Promise<EdgePendingEdgeLogin> {
      return await requestEdgeLogin(ai, appId, opts)
    },

    async requestOtpReset(
      username: string,
      otpResetToken: string
    ): Promise<Date> {
      return await resetOtp(ai, username, otpResetToken)
    },

    async fetchLoginMessages(): Promise<EdgeLoginMessages> {
      return await fetchLoginMessages(ai)
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

    get logSettings(): EdgeLogSettings {
      return ai.props.state.logSettings
    },

    async changeLogSettings(settings: Partial<EdgeLogSettings>): Promise<void> {
      const newSettings = { ...ai.props.state.logSettings, ...settings }
      ai.props.dispatch({ type: 'CHANGE_LOG_SETTINGS', payload: newSettings })
    }
  }
  bridgifyObject(out)

  return out
}
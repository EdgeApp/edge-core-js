import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { checkPasswordRules, fixUsername } from '../../client-side'
import {
  EdgeAccount,
  EdgeAccountOptions,
  EdgeContext,
  EdgeCreateAccountOptions,
  EdgeLoginMessage,
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
import {
  getEmptyStash,
  getStashById,
  getStashByUsername
} from '../login/login-selectors'
import { removeStash, saveStash } from '../login/login-stash'
import { resetOtp } from '../login/otp'
import { loginPassword } from '../login/password'
import { loginPin2 } from '../login/pin2'
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

  const out: EdgeContext & { $internalStuff: EdgeInternalStuff } = {
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
      const { stashes } = ai.props.state.login
      return stashes
        .map(stash => stash.username)
        .filter((username): username is string => username != null)
    },

    async deleteLocalAccount(username: string): Promise<void> {
      username = fixUsername(username)

      // Safety check:
      for (const accountId of ai.props.state.accountIds) {
        const accountState = ai.props.state.accounts[accountId]
        if (accountState.stashTree.username === username) {
          throw new Error('Cannot remove logged-in user')
        }
      }

      return await removeStash(ai, username)
    },

    async usernameAvailable(username: string): Promise<boolean> {
      username = fixUsername(username)
      return await usernameAvailable(ai, username)
    },

    async createAccount(
      opts: EdgeCreateAccountOptions & EdgeAccountOptions
    ): Promise<EdgeAccount> {
      if (opts.username != null) {
        opts.username = fixUsername(opts.username)
      }
      const loginTree = await createLogin(ai, opts, opts)
      return await makeAccount(ai, appId, loginTree, 'newAccount', opts)
    },

    async loginWithKey(
      usernameOrLoginId: string,
      loginKey: string,
      opts: EdgeAccountOptions & { useLoginId?: boolean } = {}
    ): Promise<EdgeAccount> {
      const { now = new Date(), useLoginId = false } = opts

      const stashTree = useLoginId
        ? getStashById(ai, base58.parse(usernameOrLoginId)).stashTree
        : getStashByUsername(ai, fixUsername(usernameOrLoginId))
      if (stashTree == null) {
        throw new Error('User does not exist on this device')
      }

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
      username = fixUsername(username)
      const stashTree = getStashByUsername(ai, username)
      const loginTree = await loginPassword(
        ai,
        stashTree ?? getEmptyStash(username),
        password,
        opts
      )
      return await makeAccount(ai, appId, loginTree, 'passwordLogin', opts)
    },

    checkPasswordRules,

    async pinLoginEnabled(username: string): Promise<boolean> {
      username = fixUsername(username)
      for (const userInfo of ai.props.state.login.localUsers) {
        if (userInfo.username === username) {
          return userInfo.pinLoginEnabled
        }
      }
      return false
    },

    async loginWithPIN(
      usernameOrLoginId: string,
      pin: string,
      opts = {}
    ): Promise<EdgeAccount> {
      const { useLoginId = false } = opts

      const stashTree = useLoginId
        ? getStashById(ai, base58.parse(usernameOrLoginId)).stashTree
        : getStashByUsername(ai, fixUsername(usernameOrLoginId))
      if (stashTree == null) {
        throw new Error('User does not exist on this device')
      }

      const loginTree = await loginPin2(ai, appId, stashTree, pin, opts)
      return await makeAccount(ai, appId, loginTree, 'pinLogin', opts)
    },

    async loginWithRecovery2(
      recovery2Key: string,
      username: string,
      answers: string[],
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      username = fixUsername(username)
      const stashTree = getStashByUsername(ai, username)
      const loginTree = await loginRecovery2(
        ai,
        stashTree ?? getEmptyStash(username),
        base58.parse(recovery2Key),
        answers,
        opts
      )
      return await makeAccount(ai, appId, loginTree, 'recoveryLogin', opts)
    },

    async fetchRecovery2Questions(
      recovery2Key: string,
      username: string
    ): Promise<string[]> {
      username = fixUsername(username)
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
      username = fixUsername(username)
      return await resetOtp(ai, username, otpResetToken)
    },

    async fetchLoginMessages(): Promise<EdgeLoginMessage[]> {
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

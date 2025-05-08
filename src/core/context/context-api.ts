import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { checkPasswordRules, fixUsername } from '../../client-side'
import {
  asChallengeErrorPayload,
  asMaybePasswordError,
  asMaybePinDisabledError,
  EdgeAccount,
  EdgeAccountOptions,
  EdgeContext,
  EdgeCreateAccountOptions,
  EdgeLoginMessage,
  EdgeLogSettings,
  EdgePendingEdgeLogin,
  EdgeUserInfo,
  PinDisabledError
} from '../../types/types'
import { verifyData } from '../../util/crypto/verify'
import { base58 } from '../../util/encoding'
import { makeAccount } from '../account/account-init'
import { createLogin, usernameAvailable } from '../login/create'
import { requestEdgeLogin } from '../login/edge'
import {
  decryptChildKey,
  makeAuthJson,
  searchTree,
  syncLogin
} from '../login/login'
import { loginFetch } from '../login/login-fetch'
import { fetchLoginMessages } from '../login/login-messages'
import {
  getEmptyStash,
  getStashById,
  getStashByUsername
} from '../login/login-selectors'
import { LoginStash, removeStash, saveStash } from '../login/login-stash'
import { SessionKey } from '../login/login-types'
import { resetOtp } from '../login/otp'
import { loginPassword } from '../login/password'
import { findPin2Stash, loginPin2 } from '../login/pin2'
import { getQuestions2, loginRecovery2 } from '../login/recovery2'
import { ApiInput } from '../root-pixie'
import { CLIENT_FILE_NAME, clientFile } from './client-file'
import { EdgeInternalStuff } from './internal-api'

export function makeContextApi(ai: ApiInput): EdgeContext {
  const appId = ai.props.state.login.contextAppId
  const clientId = base58.stringify(ai.props.state.clientInfo.clientId)
  const $internalStuff = new EdgeInternalStuff(ai)
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  async function disableDuressMode(): Promise<void> {
    // Persist disabled duress mode
    await clientFile.save(ai.props.io.disklet, CLIENT_FILE_NAME, {
      ...ai.props.state.clientInfo,
      duressEnabled: false
    })
    // Disable duress mode
    ai.props.dispatch({
      type: 'LOGIN_DURESS_MODE_DISABLED'
    })
  }
  async function enableDuressMode(): Promise<void> {
    // Persist enabled duress mode
    await clientFile.save(ai.props.io.disklet, CLIENT_FILE_NAME, {
      ...ai.props.state.clientInfo,
      duressEnabled: true
    })
    // Enable duress mode
    ai.props.dispatch({
      type: 'LOGIN_DURESS_MODE_ENABLED'
    })
  }

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

    async forgetAccount(rootLoginId: string): Promise<void> {
      const loginId = base58.parse(rootLoginId)

      // Safety check:
      for (const accountId of ai.props.state.accountIds) {
        const accountState = ai.props.state.accounts[accountId]
        if (verifyData(accountState.stashTree.loginId, loginId)) {
          throw new Error('Cannot remove logged-in user')
        }
      }

      await removeStash(ai, loginId)
    },

    async fetchChallenge() {
      const response = await loginFetch(ai, 'POST', '/v2/captcha/create', {})
      const { challengeId, challengeUri } = asChallengeErrorPayload(response)
      return { challengeId, challengeUri }
    },

    async usernameAvailable(username: string, opts = {}): Promise<boolean> {
      const { challengeId } = opts
      username = fixUsername(username)
      return await usernameAvailable(ai, username, challengeId)
    },

    async createAccount(
      opts: EdgeCreateAccountOptions & EdgeAccountOptions
    ): Promise<EdgeAccount> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeContext.createAccount', {})

      if (opts.username != null) {
        opts.username = fixUsername(opts.username)
      }
      const sessionKey = await createLogin(ai, opts, opts)
      return await makeAccount(ai, sessionKey, 'newAccount', opts)
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

      const appStash = searchTree(stashTree, stash => stash.appId === appId)
      if (appStash == null) {
        throw new Error(`Cannot find requested appId: "${appId}"`)
      }
      const sessionKey: SessionKey = {
        loginId: appStash.loginId,
        loginKey: base58.parse(loginKey)
      }

      // Verify that the provided key works for decryption:
      makeAuthJson(stashTree, sessionKey)

      // Save the date:
      stashTree.lastLogin = now
      saveStash(ai, stashTree).catch(() => {})

      // Since we logged in offline, update the stash in the background:
      syncLogin(ai, sessionKey).catch(error => ai.props.onError(error))

      return await makeAccount(ai, sessionKey, 'keyLogin', opts)
    },

    async loginWithPassword(
      username: string,
      password: string,
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeContext.loginWithPassword', {})

      username = fixUsername(username)
      // If we don't have a stash for this username,
      // then this must be a first-time login on this device:
      const stash = getStashByUsername(ai, username) ?? getEmptyStash(username)
      const sessionKey = await loginPassword(ai, stash, password, opts)

      // Attempt to log into duress account if duress mode is enabled:
      if (ai.props.state.clientInfo.duressEnabled) {
        const duressAppId = appId + '.duress'
        const duressStash = searchTree(
          stash,
          stash => stash.appId === duressAppId
        )
        // We may still be in duress mode but not log in into a duress account
        // if it does not exist. It's important that we do not disable duress
        // mode from this routine to make sure other accounts with duress mode
        // still are protected.
        if (duressStash != null) {
          const duressSessionKey = decryptChildKey(
            stash,
            sessionKey,
            duressStash.loginId
          )
          return await makeAccount(ai, duressSessionKey, 'passwordLogin', {
            ...opts,
            duressMode: true
          })
        }
      }

      return await makeAccount(ai, sessionKey, 'passwordLogin', opts)
    },

    checkPasswordRules,

    async loginWithPIN(
      usernameOrLoginId: string,
      pin: string,
      opts = {}
    ): Promise<EdgeAccount> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeContext.loginWithPIN', {})

      const { useLoginId = false } = opts

      const stashTree = useLoginId
        ? getStashById(ai, base58.parse(usernameOrLoginId)).stashTree
        : getStashByUsername(ai, fixUsername(usernameOrLoginId))
      if (stashTree == null) {
        throw new Error('User does not exist on this device')
      }

      const mainStash = findPin2Stash(stashTree, appId)
      if (mainStash == null) {
        throw new PinDisabledError(
          'PIN login is not enabled for this account on this device'
        )
      }

      const duressAppId = appId + '.duress'
      const duressStash = searchTree(
        stashTree,
        stash => stash.appId === duressAppId
      )

      async function loginMainAccount(
        stashTree: LoginStash,
        mainStash: LoginStash
      ): Promise<EdgeAccount> {
        const sessionKey = await loginPin2(ai, stashTree, mainStash, pin, opts)
        // Make the account for the main account
        return await makeAccount(ai, sessionKey, 'pinLogin', opts)
      }

      async function loginDuressAccount(
        stashTree: LoginStash,
        duressStash: LoginStash
      ): Promise<EdgeAccount> {
        // Try login with duress account
        const sessionKey = await loginPin2(
          ai,
          stashTree,
          duressStash,
          pin,
          opts
        )
        // Make the account with duress mode enabled
        return await makeAccount(ai, sessionKey, 'pinLogin', {
          ...opts,
          duressMode: true
        })
      }

      // No duress account configured, so just login to the main account:
      if (duressStash == null) {
        // It's important that we don't disable duress mode here because
        // we want to protect account that have duress mode enabled and only
        // allow those accounts to suspend duress mode.
        return await loginMainAccount(stashTree, mainStash)
      }

      // Check if we are in duress mode:
      const inDuressMode = ai.props.state.clientInfo.duressEnabled

      // Try pin-login on either the duress or main accounts, smartly:
      try {
        return inDuressMode
          ? await loginDuressAccount(stashTree, duressStash)
          : await loginMainAccount(stashTree, mainStash)
      } catch (error) {
        // If the error is not a failed login, rethrow it:
        if (
          asMaybePasswordError(error) == null &&
          asMaybePinDisabledError(error) == null
        ) {
          throw error
        }
        const account = inDuressMode
          ? await loginMainAccount(stashTree, mainStash)
          : await loginDuressAccount(stashTree, duressStash)
        // Only Enable/Disable duress mode if account creation was success.
        if (inDuressMode) {
          await disableDuressMode()
        } else {
          await enableDuressMode()
        }
        return account
      }
    },

    async loginWithRecovery2(
      recovery2Key: string,
      username: string,
      answers: string[],
      opts: EdgeAccountOptions = {}
    ): Promise<EdgeAccount> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeContext.loginWithRecovery2', {})

      username = fixUsername(username)
      const stashTree = getStashByUsername(ai, username)
      const sessionKey = await loginRecovery2(
        ai,
        stashTree ?? getEmptyStash(username),
        base58.parse(recovery2Key),
        answers,
        opts
      )
      return await makeAccount(ai, sessionKey, 'recoveryLogin', opts)
    },

    async fetchRecovery2Questions(
      recovery2Key: string,
      username: string
    ): Promise<string[]> {
      username = fixUsername(username)
      return await getQuestions2(ai, base58.parse(recovery2Key), username)
    },

    async requestEdgeLogin(
      opts?: EdgeAccountOptions
    ): Promise<EdgePendingEdgeLogin> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeContext.requestEdgeLogin', {})

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

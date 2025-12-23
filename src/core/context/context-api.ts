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
  PasswordError,
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
  async function updateLoginWaitTimestamp(
    loginId: string,
    timestamp: number
  ): Promise<void> {
    await clientFile.save(ai.props.io.disklet, CLIENT_FILE_NAME, {
      ...ai.props.state.clientInfo,
      loginWaitTimestamps: {
        ...ai.props.state.clientInfo.loginWaitTimestamps,
        [loginId]: timestamp
      }
    })
    ai.props.dispatch({
      type: 'LOGIN_WAIT_TIMESTAMP_UPDATED',
      payload: {
        loginId,
        timestamp
      }
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
      const inDuressMode = ai.props.state.clientInfo.duressEnabled

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

      // Get the duress stash for existence check:
      const duressAppId = appId + '.duress'
      const duressStash = searchTree(
        stashTree,
        stash => stash.appId === duressAppId
      )

      let sessionKey: SessionKey
      try {
        sessionKey = {
          loginId: appStash.loginId,
          loginKey: base58.parse(loginKey)
        }

        // Verify that the provided key works for decryption:
        makeAuthJson(stashTree, sessionKey)
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid checksum') {
          if (duressStash == null) {
            throw error
          }
          sessionKey = {
            loginId: duressStash.loginId,
            loginKey: base58.parse(loginKey)
          }

          // Verify that the provided key works for decryption:
          makeAuthJson(stashTree, sessionKey)
        } else {
          throw error
        }
      }

      // Save the date:
      stashTree.lastLogin = now
      saveStash(ai, stashTree).catch(() => {})

      // Since we logged in offline, update the stash in the background:
      syncLogin(ai, sessionKey).catch(error => ai.props.onError(error))

      return await makeAccount(ai, sessionKey, 'keyLogin', {
        ...opts,
        // We must require that the duress account is active.
        // Duress account is active if it exists and has a PIN key:
        duressMode: inDuressMode && duressStash?.pin2Key != null
      })
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
        const stash = getStashByUsername(ai, username)
        if (stash == null) {
          // This should never happen.
          throw new Error('Missing stash after login with password')
        }
        const duressStash = searchTree(
          stash,
          stash => stash.appId === duressAppId
        )
        // We may still be in duress mode but do not log-in to a duress account
        // if it does not exist. It's important that we do not disable duress
        // mode from this routine to make sure other accounts with duress mode
        // still are protected.
        // Duress account is active if it exists and has a PIN key:
        if (duressStash?.pin2Key != null) {
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

      const duressAppId = appId + '.duress'
      const duressStash = searchTree(
        stashTree,
        stash => stash.appId === duressAppId
      )

      async function loginMainAccount(
        stashTree: LoginStash,
        mainStash: LoginStash
      ): Promise<EdgeAccount> {
        // Try login with the WIP change, in the case where it's the valid
        // login stash. Fail gracefully with the original stash tree if it fails:
        const sessionKey: SessionKey =
          stashTree.wipChange != null
            ? await loginPin2(
                ai,
                stashTree.wipChange,
                mainStash,
                pin,
                opts
              ).catch(
                async () => await loginPin2(ai, stashTree, mainStash, pin, opts)
              )
            : await loginPin2(ai, stashTree, mainStash, pin, opts)
        // Make the account for the main account
        return await makeAccount(ai, sessionKey, 'pinLogin', opts)
      }

      async function loginDuressAccount(
        stashTree: LoginStash,
        duressStash: LoginStash
      ): Promise<EdgeAccount> {
        if (duressStash.fakePinDisabled === true) {
          throw new PinDisabledError(
            'PIN login is not enabled for this account on this device'
          )
        }

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

      if (mainStash == null) {
        if (duressStash == null) {
          throw new PinDisabledError(
            'PIN login is not enabled for this account on this device'
          )
        }
        // Just try PIN-login on duress account since PIN-login is not enabled
        // on the main account:
        return await loginDuressAccount(stashTree, duressStash)
      }

      // No duress account configured, so just login to the main account:
      if (duressStash?.pin2Key == null) {
        // It's important that we don't disable duress mode here because
        // we want to protect account that have duress mode enabled and only
        // allow those accounts to suspend duress mode.
        return await loginMainAccount(stashTree, mainStash)
      }

      // Check if we are in duress mode:
      const inDuressMode = ai.props.state.clientInfo.duressEnabled

      // Check if we are in a wait period for account as a whole:
      const mainLoginId = base58.stringify(mainStash.loginId)
      const loginWaitTimestamp =
        ai.props.state.clientInfo.loginWaitTimestamps[mainLoginId]
      if (loginWaitTimestamp != null && loginWaitTimestamp > Date.now()) {
        throw new PasswordError({
          wait_seconds: Math.ceil((loginWaitTimestamp - Date.now()) / 1000)
        })
      }

      // Try pin-login on either the duress or main accounts, smartly:
      try {
        return inDuressMode
          ? await loginDuressAccount(stashTree, duressStash)
          : await loginMainAccount(stashTree, mainStash)
      } catch (originalError) {
        // If the error is not a failed login, rethrow it:
        if (asMaybePasswordError(originalError) == null) {
          throw originalError
        }
        try {
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
        } catch (error) {
          /**
           * We need to store the max wait time for the account as a whole (or
           * both main and duress accounts) because we don't know which account
           * the user will try to login. We will block the login on this stored
           * timestamp.
           */
          const maxWaitError = [
            asMaybePasswordError(error),
            asMaybePasswordError(originalError)
          ].reduce((a, b) => {
            const aWait = a?.wait ?? 0
            const bWait = b?.wait ?? 0
            if (aWait > bWait) return a
            return b
          })
          // Convert wait time to milliseconds:
          const maxWaitMilliseconds = (maxWaitError?.wait ?? 0) * 1000
          if (maxWaitError != null && maxWaitMilliseconds > 0) {
            const timestamp = Date.now() + maxWaitMilliseconds
            await updateLoginWaitTimestamp(mainLoginId, timestamp)
            throw maxWaitError
          }

          // Throw the original error if pin-login is disabled:
          if (asMaybePinDisabledError(error) != null) {
            throw originalError
          }
          throw error
        }
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

// @flow

import { stopUpdates } from 'redux-pixies'

import type {
  EdgeAccountOptions,
  EdgeContext,
  EdgeEdgeLoginOptions,
  EdgeExchangeSwapInfo,
  EdgeLoginMessages
} from '../../edge-core-index.js'
import { wrapObject } from '../../util/api.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-api.js'
import { makeShapeshiftApi } from '../exchange/shapeshift.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { fetchLoginMessages, makeLoginTree, resetOtp } from '../login/login.js'
import { fixUsername } from '../login/loginStore.js'
import { checkPasswordRules, loginPassword } from '../login/password.js'
import { getPin2Key, loginPin2 } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  listRecoveryQuestionChoices,
  loginRecovery2
} from '../login/recovery2.js'
import type { ApiInput } from '../root.js'
import { EdgeInternalStuff } from './internal-api.js'

export const contextApiPixie = (ai: ApiInput) => () => {
  ai.onOutput(makeContextApi(ai))
  return stopUpdates
}

function makeContextApi (ai: ApiInput) {
  const appId = ai.props.state.login.appId
  const { loginStore } = ai.props
  const internalApi = new EdgeInternalStuff(ai)

  const shapeshiftApi = makeShapeshiftApi(ai)

  const rawContext: EdgeContext = {
    appId,

    get _internalEdgeStuff () {
      return internalApi
    },

    '@fixUsername': { sync: true },
    fixUsername (username: string): string {
      return fixUsername(username)
    },

    listUsernames (): Promise<Array<string>> {
      return loginStore.listUsernames()
    },

    deleteLocalAccount (username: string): Promise<mixed> {
      return loginStore.remove(username)
    },

    usernameAvailable (username: string): Promise<boolean> {
      return usernameAvailable(ai, username)
    },

    createAccount (
      username: string,
      password?: string,
      pin?: string,
      opts?: EdgeAccountOptions
    ) {
      const { callbacks } = opts || {} // opts can be `null`

      return createLogin(ai, username, {
        password,
        pin
      }).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'newAccount', callbacks)
      })
    },

    loginWithKey (
      username: string,
      loginKey: string,
      opts?: EdgeAccountOptions
    ) {
      const { callbacks } = opts || {} // opts can be `null`

      return loginStore.load(username).then(stashTree => {
        const loginTree = makeLoginTree(
          stashTree,
          base58.parse(loginKey),
          appId
        )
        return makeAccount(ai, appId, loginTree, 'keyLogin', callbacks)
      })
    },

    loginWithPassword (
      username: string,
      password: string,
      opts?: EdgeAccountOptions
    ) {
      const { callbacks, otp } = opts || {} // opts can be `null`

      return loginPassword(ai, username, password, otp).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'passwordLogin', callbacks)
      })
    },

    '@checkPasswordRules': { sync: true },
    checkPasswordRules (password) {
      return checkPasswordRules(password)
    },

    async pinExists (username: string) {
      const loginStash = await loginStore.load(username)
      const pin2Key = getPin2Key(loginStash, appId)
      return pin2Key && pin2Key.pin2Key != null
    },

    pinLoginEnabled (username: string) {
      return this.pinExists(username)
    },

    loginWithPIN (username: string, pin: string, opts?: EdgeAccountOptions) {
      const { callbacks, otp } = opts || {} // opts can be `null`

      return loginPin2(ai, appId, username, pin, otp).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'pinLogin', callbacks)
      })
    },

    getRecovery2Key (username: string) {
      return loginStore.load(username).then(loginStash => {
        const recovery2Key = getRecovery2Key(loginStash)
        if (recovery2Key == null) {
          throw new Error('No recovery key stored locally.')
        }
        return base58.stringify(recovery2Key)
      })
    },

    loginWithRecovery2 (
      recovery2Key: string,
      username: string,
      answers: Array<string>,
      opts?: EdgeAccountOptions
    ) {
      const { callbacks, otp } = opts || {} // opts can be `null`

      return loginRecovery2(
        ai,
        base58.parse(recovery2Key),
        username,
        answers,
        otp
      ).then(loginTree => {
        return makeAccount(ai, appId, loginTree, 'recoveryLogin', callbacks)
      })
    },

    fetchRecovery2Questions (recovery2Key: string, username: string) {
      return getQuestions2(ai, base58.parse(recovery2Key), username)
    },

    listRecoveryQuestionChoices () {
      return listRecoveryQuestionChoices(ai)
    },

    requestEdgeLogin (opts: EdgeEdgeLoginOptions) {
      const {
        callbacks,
        onLogin,
        displayImageUrl,
        displayName,
        onProcessLogin
      } = opts

      return requestEdgeLogin(ai, appId, {
        displayImageUrl,
        displayName,
        onProcessLogin,
        onLogin (err, loginTree) {
          if (err || !loginTree) return onLogin(err)
          makeAccount(ai, appId, loginTree, 'edgeLogin', callbacks).then(
            account => onLogin(void 0, account),
            err => onLogin(err)
          )
        }
      })
    },

    requestOtpReset (username: string, otpResetToken: string): Promise<Date> {
      return resetOtp(ai, username, otpResetToken)
    },

    fetchLoginMessages (): Promise<EdgeLoginMessages> {
      return fetchLoginMessages(ai)
    },

    getExchangeSwapRate (
      fromCurrencyCode: string,
      toCurrencyCode: string
    ): Promise<number> {
      return shapeshiftApi.getExchangeSwapRate(fromCurrencyCode, toCurrencyCode)
    },

    getAvailableExchangeTokens (): Promise<Array<string>> {
      return shapeshiftApi.getAvailableExchangeTokens()
    },

    getExchangeSwapInfo (
      fromCurrencyCode: string,
      toCurrencyCode: string
    ): Promise<EdgeExchangeSwapInfo> {
      return shapeshiftApi.getExchangeSwapInfo(fromCurrencyCode, toCurrencyCode)
    }
  }

  // Wrap the context with logging:
  const out = wrapObject('Context', rawContext)

  return out
}

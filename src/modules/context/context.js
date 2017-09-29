// @flow
import type {
  AbcContext,
  AbcContextOptions,
  AbcEdgeLoginOptions
} from 'airbitz-core-types'
import { wrapObject } from '../../util/api.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/accountApi.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { makeLoginTree } from '../login/login.js'
import { fixUsername } from '../login/loginStore.js'
import { checkPasswordRules, loginPassword } from '../login/password.js'
import { getPin2Key, loginPin2 } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  listRecoveryQuestionChoices,
  loginRecovery2
} from '../login/recovery2.js'
import { makeCoreRoot, startCoreRoot } from '../root.js'
import { awaitPluginsLoaded } from '../selectors.js'

export function makeContext (opts: AbcContextOptions) {
  const coreRoot = makeCoreRoot(opts)
  startCoreRoot(coreRoot)
  const { redux } = coreRoot

  const appId =
    opts.appId != null
      ? opts.appId
      : typeof opts.accountType === 'string'
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''

  const rawContext: AbcContext = {
    io: (coreRoot.io: any),
    appId,

    async getCurrencyPlugins () {
      await awaitPluginsLoaded(redux)
      return redux.getState().plugins.currencyPlugins
    },

    '@fixUsername': { sync: true },
    fixUsername (username: string): string {
      return fixUsername(username)
    },

    listUsernames (): Promise<Array<string>> {
      return coreRoot.loginStore.listUsernames()
    },

    deleteLocalAccount (username: string): Promise<void> {
      return coreRoot.loginStore.remove(username)
    },

    usernameAvailable (username: string): Promise<boolean> {
      return usernameAvailable(coreRoot, username)
    },

    createAccount (username: string, password?: string, pin?: string, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return createLogin(coreRoot, username, {
        password,
        pin
      }).then(loginTree => {
        return makeAccount(coreRoot, appId, loginTree, 'newAccount', callbacks)
      })
    },

    loginWithKey (username: string, loginKey: string, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return coreRoot.loginStore.load(username).then(stashTree => {
        const loginTree = makeLoginTree(
          stashTree,
          base58.parse(loginKey),
          appId
        )
        return makeAccount(coreRoot, appId, loginTree, 'keyLogin', callbacks)
      })
    },

    loginWithPassword (username: string, password: string, opts): Promise<any> {
      const { callbacks } = opts || {} // opts can be `null`

      return loginPassword(coreRoot, username, password).then(loginTree => {
        return makeAccount(
          coreRoot,
          appId,
          loginTree,
          'passwordLogin',
          callbacks
        )
      })
    },

    '@checkPasswordRules': { sync: true },
    checkPasswordRules (password) {
      return checkPasswordRules(password)
    },

    async pinExists (username) {
      const loginStash = await coreRoot.loginStore.load(username)
      const pin2Key = getPin2Key(loginStash, appId)
      return pin2Key && pin2Key.pin2Key != null
    },

    pinLoginEnabled (username) {
      return this.pinExists(username)
    },

    loginWithPIN (username, pin, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return loginPin2(coreRoot, appId, username, pin).then(loginTree => {
        return makeAccount(coreRoot, appId, loginTree, 'pinLogin', callbacks)
      })
    },

    getRecovery2Key (username) {
      return coreRoot.loginStore.load(username).then(loginStash => {
        const recovery2Key = getRecovery2Key(loginStash)
        if (recovery2Key == null) {
          throw new Error('No recovery key stored locally.')
        }
        return base58.stringify(recovery2Key)
      })
    },

    loginWithRecovery2 (recovery2Key: string, username, answers, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return loginRecovery2(
        coreRoot,
        base58.parse(recovery2Key),
        username,
        answers
      ).then(loginTree => {
        return makeAccount(
          coreRoot,
          appId,
          loginTree,
          'recoveryLogin',
          callbacks
        )
      })
    },

    fetchRecovery2Questions (recovery2Key, username) {
      return getQuestions2(coreRoot, base58.parse(recovery2Key), username)
    },

    listRecoveryQuestionChoices () {
      return listRecoveryQuestionChoices(coreRoot)
    },

    requestEdgeLogin (opts: AbcEdgeLoginOptions) {
      const {
        callbacks,
        onLogin,
        displayImageUrl,
        displayName,
        onProcessLogin
      } = opts

      return requestEdgeLogin(coreRoot, appId, {
        displayImageUrl,
        displayName,
        onProcessLogin,
        onLogin (err, loginTree) {
          if (err) return onLogin(err)
          makeAccount(coreRoot, appId, loginTree, 'edgeLogin', callbacks).then(
            account => onLogin(void 0, account),
            err => onLogin(err)
          )
        }
      })
    }
  }

  // Wrap the context with logging:
  const out = wrapObject(coreRoot.onError, 'Context', rawContext)
  out.usernameList = out.listUsernames
  out.removeUsername = out.deleteLocalAccount

  return out
}

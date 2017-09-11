// @flow
import { makeCoreRoot } from '../coreRoot.js'
import { makeAccount } from '../account/accountApi.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { makeLoginTree } from '../login/login.js'
import { checkPasswordRules, loginPassword } from '../login/password.js'
import { loginPin2, getPin2Key } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  loginRecovery2,
  listRecoveryQuestionChoices
} from '../login/recovery2.js'
import { awaitPluginsLoaded } from '../redux/selectors.js'
import { wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'
import { fixUsername } from './loginStore.js'
import type { AbcContextOptions } from 'airbitz-core-types'

export function makeContext (opts: AbcContextOptions) {
  const coreRoot = makeCoreRoot(opts)
  const { redux } = coreRoot

  const appId =
    opts.appId != null
      ? opts.appId
      : typeof opts.accountType === 'string'
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''

  const out = wrapObject(coreRoot.onError, 'Context', {
    io: coreRoot.io,
    appId,

    coreRoot, // TODO: Stop allowing the tests to access our guts

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

    createAccount (username: string, password: string, pin: string, opts) {
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

    pinExists (username) {
      return coreRoot.loginStore
        .load(username)
        .then(loginStash => getPin2Key(loginStash, appId).pin2Key != null)
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

    requestEdgeLogin (opts) {
      const { callbacks, onLogin } = opts

      opts.onLogin = (err, loginTree) => {
        if (err) return onLogin(err)
        makeAccount(coreRoot, appId, loginTree).then(
          account => onLogin(null, account),
          err => onLogin(err)
        )
      }
      return requestEdgeLogin(coreRoot, appId, opts, callbacks)
    }
  })

  out.usernameList = out.listUsernames
  out.removeUsername = out.deleteLocalAccount

  return out
}

// @flow
import type { AbcContextOptions } from 'airbitz-core-types'
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
import { makeBrowserIo } from './browser'
import { IoContext } from './io.js'
import { fixUsername } from './loginStore.js'

export function makeContext (opts: AbcContextOptions) {
  const io = new IoContext(opts.io != null ? opts.io : makeBrowserIo(), opts)
  const { redux } = io

  const appId =
    opts.appId != null
      ? opts.appId
      : typeof opts.accountType === 'string'
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''

  const out = wrapObject(io.onError, 'Context', {
    io,
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
      return io.loginStore.listUsernames()
    },

    deleteLocalAccount (username: string): Promise<void> {
      return io.loginStore.remove(username)
    },

    usernameAvailable (username: string): Promise<boolean> {
      return usernameAvailable(io, username)
    },

    createAccount (username: string, password: string, pin: string, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return createLogin(io, username, {
        password,
        pin
      }).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'newAccount', callbacks)
      })
    },

    loginWithKey (username: string, loginKey: string, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return io.loginStore.load(username).then(stashTree => {
        const loginTree = makeLoginTree(
          stashTree,
          base58.parse(loginKey),
          appId
        )
        return makeAccount(io, appId, loginTree, 'keyLogin', callbacks)
      })
    },

    loginWithPassword (username: string, password: string, opts): Promise<any> {
      const { callbacks } = opts || {} // opts can be `null`

      return loginPassword(io, username, password).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'passwordLogin', callbacks)
      })
    },

    '@checkPasswordRules': { sync: true },
    checkPasswordRules (password) {
      return checkPasswordRules(password)
    },

    pinExists (username) {
      return io.loginStore
        .load(username)
        .then(loginStash => getPin2Key(loginStash, appId).pin2Key != null)
    },

    pinLoginEnabled (username) {
      return this.pinExists(username)
    },

    loginWithPIN (username, pin, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      return loginPin2(io, appId, username, pin).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'pinLogin', callbacks)
      })
    },

    getRecovery2Key (username) {
      return io.loginStore.load(username).then(loginStash => {
        const recovery2Key = getRecovery2Key(loginStash)
        if (recovery2Key == null) {
          throw new Error('No recovery key stored locally.')
        }
        return base58.stringify(recovery2Key)
      })
    },

    loginWithRecovery2 (recovery2Key, username, answers, opts) {
      const { callbacks } = opts || {} // opts can be `null`

      recovery2Key = base58.parse(recovery2Key)
      return loginRecovery2(
        io,
        recovery2Key,
        username,
        answers
      ).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'recoveryLogin', callbacks)
      })
    },

    fetchRecovery2Questions (recovery2Key, username) {
      recovery2Key = base58.parse(recovery2Key)
      return getQuestions2(io, recovery2Key, username)
    },

    listRecoveryQuestionChoices () {
      return listRecoveryQuestionChoices(io)
    },

    requestEdgeLogin (opts) {
      const { callbacks, onLogin } = opts

      opts.onLogin = (err, loginTree) => {
        if (err) return onLogin(err)
        makeAccount(io, appId, loginTree).then(
          account => onLogin(null, account),
          err => onLogin(err)
        )
      }
      return requestEdgeLogin(io, appId, opts, callbacks)
    }
  })

  out.usernameList = out.listUsernames
  out.removeUsername = out.deleteLocalAccount

  return out
}

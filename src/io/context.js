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
import { wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'
import { makeBrowserIo } from './browser'
import { IoContext } from './io.js'
import { fixUsername } from './loginStore.js'

export function makeContext (opts) {
  const io = new IoContext(opts.io != null ? opts.io : makeBrowserIo(), opts)
  const appId =
    opts.appId != null
      ? opts.appId
      : opts.accountType != null
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''

  const out = wrapObject(io.onError, 'Context', {
    io,
    appId,

    '@fixUsername': { sync: true },
    fixUsername (username) {
      return fixUsername(username)
    },

    listUsernames () {
      return io.loginStore.listUsernames()
    },

    removeUsername (username) {
      return io.loginStore.remove(username)
    },

    usernameAvailable (username) {
      return usernameAvailable(io, username)
    },

    createAccount (username, password, pin) {
      return createLogin(io, username, {
        password,
        pin
      }).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'newAccount')
      })
    },

    loginWithKey (username, loginKey) {
      return io.loginStore.load(username).then(stashTree => {
        const loginTree = makeLoginTree(
          stashTree,
          base58.parse(loginKey),
          appId
        )
        return makeAccount(io, appId, loginTree, 'keyLogin')
      })
    },

    loginWithPassword (username, password) {
      return loginPassword(io, username, password).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'passwordLogin')
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

    loginWithPIN (username, pin) {
      return loginPin2(io, appId, username, pin).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'pinLogin')
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

    loginWithRecovery2 (recovery2Key, username, answers) {
      recovery2Key = base58.parse(recovery2Key)
      return loginRecovery2(
        io,
        recovery2Key,
        username,
        answers
      ).then(loginTree => {
        return makeAccount(io, appId, loginTree, 'recoveryLogin')
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
      const onLogin = opts.onLogin
      opts.onLogin = (err, loginTree) => {
        if (err) return onLogin(err)
        makeAccount(io, appId, loginTree).then(
          account => onLogin(null, account),
          err => onLogin(err)
        )
      }
      return requestEdgeLogin(io, appId, opts)
    }
  })

  out.usernameList = out.listUsernames

  return out
}

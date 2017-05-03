import { makeBrowserIo } from '../io/browser'
import { IoContext } from '../io/io.js'
import { fixUsername } from '../io/loginStore.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { checkPasswordRules, loginPassword } from '../login/password.js'
import { loginPin2, getPin2Key } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  loginRecovery2,
  listRecoveryQuestionChoices
} from '../login/recovery2.js'
import { base58 } from '../util/encoding.js'
import { makeAccount } from './account.js'
import { wrapPrototype } from './wrap.js'

export function Context (opts) {
  this.io = new IoContext(opts.io != null ? opts.io : makeBrowserIo(), opts)
  this.appId = opts.appId != null
    ? opts.appId
    : opts.accountType != null
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''
}

Context.prototype = wrapPrototype('Context', {
  '@fixUsername': { sync: true },
  fixUsername (username) {
    return fixUsername(username)
  },

  listUsernames () {
    return this.io.loginStore.listUsernames()
  },

  removeUsername (username) {
    return this.io.loginStore.remove(username)
  },

  usernameAvailable (username) {
    return usernameAvailable(this.io, username)
  },

  createAccount (username, password, pin) {
    return createLogin(this.io, username, { password, pin }).then(login => {
      return makeAccount(this, login, 'newAccount')
    })
  },

  loginWithPassword (username, password) {
    return loginPassword(this.io, username, password).then(login => {
      return makeAccount(this, login, 'passwordLogin')
    })
  },

  '@checkPasswordRules': { sync: true },
  checkPasswordRules (password) {
    return checkPasswordRules(password)
  },

  pinExists (username) {
    return this.io.loginStore
      .load(username)
      .then(loginStash => getPin2Key(loginStash, this.appId).pin2Key != null)
  },

  pinLoginEnabled (username) {
    return this.pinExists(username)
  },

  loginWithPIN (username, pin) {
    return loginPin2(this.io, this.appId, username, pin).then(login => {
      return makeAccount(this, login, 'pinLogin')
    })
  },

  getRecovery2Key (username) {
    return this.io.loginStore.load(username).then(loginStash => {
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
      this.io,
      recovery2Key,
      username,
      answers
    ).then(login => {
      return makeAccount(this, login, 'recoveryLogin')
    })
  },

  fetchRecovery2Questions (recovery2Key, username) {
    recovery2Key = base58.parse(recovery2Key)
    return getQuestions2(this.io, recovery2Key, username)
  },

  listRecoveryQuestionChoices () {
    return listRecoveryQuestionChoices(this.io)
  },

  requestEdgeLogin (opts) {
    const onLogin = opts.onLogin
    opts.onLogin = (err, login) => {
      if (err) return onLogin(err)
      makeAccount(this, login, 'edgeLogin').then(
        account => onLogin(null, account),
        err => onLogin(err)
      )
    }
    return requestEdgeLogin(this.io, this.appId, opts)
  }
})

Context.prototype.usernameList = Context.prototype.listUsernames

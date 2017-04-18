import { makeBrowserIo } from '../io/browser'
import { IoContext } from '../io/io.js'
import { fixUsername } from '../io/loginStore.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { loginPassword } from '../login/password.js'
import { loginPin2, getPin2Key } from '../login/pin2.js'
import { makeAccount } from './account.js'
import {
  getQuestions2,
  getRecovery2Key,
  loginRecovery2,
  listRecoveryQuestionChoices
} from '../login/recovery2.js'
import { asyncApi, syncApi } from '../util/decorators.js'
import { base58 } from '../util/encoding.js'

/**
 * @param opts An object containing optional arguments.
 */
export function Context (opts) {
  this.io = new IoContext(opts.io != null ? opts.io : makeBrowserIo(), opts)
  this.appId = opts.appId != null
    ? opts.appId
    : opts.accountType != null
        ? opts.accountType.replace(/^account.repo:/, '')
        : ''
}

Context.prototype.usernameList = asyncApi(function () {
  return Promise.resolve(this.io.loginStore.listUsernames())
})
Context.prototype.listUsernames = Context.prototype.usernameList

Context.prototype.fixUsername = syncApi(fixUsername)

Context.prototype.removeUsername = syncApi(function (username) {
  this.io.loginStore.remove(username)
})

Context.prototype.usernameAvailable = asyncApi(function (username) {
  return usernameAvailable(this.io, username)
})

/**
 * Creates a login, then creates and attaches an account to it.
 */
Context.prototype.createAccount = asyncApi(function (username, password, pin) {
  return createLogin(this.io, username, { password, pin }).then(login => {
    return makeAccount(this, login, 'newAccount')
  })
})

Context.prototype.loginWithPassword = asyncApi(function (
  username,
  password,
  otp,
  opts
) {
  return loginPassword(this.io, username, password).then(login => {
    return makeAccount(this, login, 'passwordLogin')
  })
})

Context.prototype.pinExists = asyncApi(function (username) {
  return this.io.loginStore
    .load(username)
    .then(loginStash => getPin2Key(loginStash, this.appId).pin2Key != null)
})
Context.prototype.pinLoginEnabled = Context.prototype.pinExists

Context.prototype.loginWithPIN = asyncApi(function (username, pin) {
  return loginPin2(this.io, this.appId, username, pin).then(login => {
    return makeAccount(this, login, 'pinLogin')
  })
})

Context.prototype.getRecovery2Key = asyncApi(function (username) {
  return this.io.loginStore.load(username).then(loginStash => {
    const recovery2Key = getRecovery2Key(loginStash)
    if (recovery2Key == null) {
      throw new Error('No recovery key stored locally.')
    }
    return base58.stringify(recovery2Key)
  })
})

Context.prototype.loginWithRecovery2 = asyncApi(function (
  recovery2Key,
  username,
  answers,
  otp,
  options
) {
  recovery2Key = base58.parse(recovery2Key)
  return loginRecovery2(
    this.io,
    recovery2Key,
    username,
    answers
  ).then(login => {
    return makeAccount(this, login, 'recoveryLogin')
  })
})

Context.prototype.fetchRecovery2Questions = asyncApi(function (
  recovery2Key,
  username
) {
  recovery2Key = base58.parse(recovery2Key)
  return getQuestions2(this.io, recovery2Key, username)
})

Context.prototype.checkPasswordRules = syncApi(function (password) {
  const tooShort = password.length < 10
  const noNumber = password.match(/\d/) == null
  const noUpperCase = password.match(/[A-Z]/) == null
  const noLowerCase = password.match(/[a-z]/) == null
  const extraLong = password.length >= 16

  return {
    tooShort,
    noNumber,
    noUpperCase,
    noLowerCase,
    passed: extraLong || !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
})

Context.prototype.requestEdgeLogin = asyncApi(function (opts) {
  const onLogin = opts.onLogin
  opts.onLogin = (err, login) => {
    if (err) return onLogin(err)
    makeAccount(this, login, 'edgeLogin').then(
      account => onLogin(null, account),
      err => onLogin(err)
    )
  }
  return requestEdgeLogin(this.io, this.appId, opts)
})

Context.prototype.listRecoveryQuestionChoices = asyncApi(function () {
  return listRecoveryQuestionChoices(this.io)
})

import {Account} from './account.js'
import {fixUsername} from './io/loginStore.js'
import * as loginCreate from './login/create.js'
import * as loginEdge from './login/edge.js'
import * as loginPassword from './login/password.js'
import * as loginPin2 from './login/pin2.js'
import * as loginRecovery2 from './login/recovery2.js'
import {nodeify} from './util/decorators.js'

/**
 * @param opts An object containing optional arguments.
 */
export function Context (io, opts) {
  this.io = io
  this.accountType = opts.accountType || 'account:repo:co.airbitz.wallet'
}

Context.prototype.usernameList = function () {
  return this.io.loginStore.listUsernames()
}
Context.prototype.listUsernames = Context.prototype.usernameList

Context.prototype.fixUsername = fixUsername

Context.prototype.removeUsername = function (username) {
  this.io.loginStore.remove({username})
}

Context.prototype.usernameAvailable = nodeify(function (username) {
  return loginCreate.usernameAvailable(this.io, username)
})

/**
 * Creates a login, then creates and attaches an account to it.
 */
Context.prototype.createAccount = nodeify(function (username, password, pin) {
  return loginCreate.create(this.io, username, password, {}).then(login => {
    try {
      login.accountFind(this.accountType)
    } catch (e) {
      // If the login doesn't have the correct account type, add it first:
      return login.accountCreate(this.io, this.accountType).then(() => {
        return loginPin2.setup(this.io, login, pin).then(() => {
          const account = new Account(this, login)
          account.newAccount = true
          return account.sync().then(() => account)
        })
      })
    }

    // Otherwise, we have the correct account type, and can simply return:
    return loginPin2.setup(this.io, login, pin).then(() => {
      const account = new Account(this, login)
      account.newAccount = true
      return account.sync().then(() => account)
    })
  })
})

Context.prototype.loginWithPassword = nodeify(function (username, password, otp, opts) {
  return loginPassword.login(this.io, username, password).then(login => {
    const account = new Account(this, login)
    account.passwordLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.pinExists = function (username) {
  return loginPin2.getKey(this.io, username) != null
}
Context.prototype.pinLoginEnabled = function (username) {
  return loginPin2.getKey(this.io, username) != null
}

Context.prototype.loginWithPIN = nodeify(function (username, pin) {
  const pin2Key = loginPin2.getKey(this.io, username)
  if (pin2Key == null) {
    throw new Error('No PIN set locally for this account')
  }
  return loginPin2.login(this.io, pin2Key, username, pin).then(login => {
    const account = new Account(this, login)
    account.pinLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.getRecovery2Key = nodeify(function (username) {
  const recovery2Key = loginRecovery2.getKey(this.io, username)
  if (recovery2Key == null) {
    return Promise.reject(new Error('No recovery key stored locally.'))
  }
  return Promise.resolve(recovery2Key)
})

Context.prototype.loginWithRecovery2 = nodeify(function (recovery2Key, username, answers, otp, options) {
  return loginRecovery2.login(this.io, recovery2Key, username, answers).then(login => {
    const account = new Account(this, login)
    account.recoveryLogin = true
    return account.sync().then(() => account)
  })
})

Context.prototype.fetchRecovery2Questions = nodeify(function (recovery2Key, username) {
  return loginRecovery2.questions(this.io, recovery2Key, username)
})

Context.prototype.checkPasswordRules = function (password) {
  const tooShort = password.length < 10
  const noNumber = password.match(/\d/) == null
  const noUpperCase = password.match(/[A-Z]/) == null
  const noLowerCase = password.match(/[a-z]/) == null
  const extraLong = password.length >= 16

  return {
    'tooShort': tooShort,
    'noNumber': noNumber,
    'noUpperCase': noUpperCase,
    'noLowerCase': noLowerCase,
    'passed': extraLong || !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}

Context.prototype.requestEdgeLogin = nodeify(function (opts) {
  const onLogin = opts.onLogin
  opts.onLogin = (err, login) => {
    if (err) return onLogin(err)
    const account = new Account(this, login)
    account.edgeLogin = true
    account.sync().then(dirty => onLogin(null, account), err => onLogin(err))
  }
  opts.type = opts.type || this.accountType
  return loginEdge.create(this.io, opts)
})

Context.prototype.listRecoveryQuestionChoices = nodeify(function () {
  return loginRecovery2.listRecoveryQuestionChoices(this.io)
})

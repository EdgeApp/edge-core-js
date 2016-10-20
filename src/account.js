var loginPassword = require('./login/password.js')
var loginPin = require('./login/pin.js')
var loginRecovery2 = require('./login/recovery2.js')
var Repo = require('./util/repo').Repo

/**
 * This is a thin shim object,
 * which wraps the core implementation in a more OOP-style API.
 */
function Account (ctx, login) {
  this.ctx = ctx
  this.login = login
  this.keys = login.accountFind(ctx.accountType)
  this.repoInfo = this.keys // Deprecated name
  this.loggedIn = true
  this.edgeLogin = false
  this.pinLogin = false
  this.passwordLogin = false
  this.newAccount = false
  this.recoveryLogin = false
  this.username = login.username

  this.repo = new Repo(ctx, new Buffer(this.keys.dataKey, 'hex'), new Buffer(this.keys.syncKey, 'hex'))
}

Account.prototype.logout = function () {
  this.login = null
  this.loggedIn = false
}

Account.prototype.passwordOk = function (password) {
  return loginPassword.check(this.ctx, this.login, password)
}
Account.prototype.checkPassword = Account.prototype.passwordOk

Account.prototype.passwordSetup = function (password, callback) {
  return loginPassword.setup(this.ctx, this.login, password, callback)
}
Account.prototype.changePassword = Account.prototype.passwordSetup

Account.prototype.pinSetup = function (pin, callback) {
  return loginPin.setup(this.ctx, this.login, pin, callback)
}
Account.prototype.changePIN = Account.prototype.pinSetup

Account.prototype.recovery2Set = function (questions, answers, callback) {
  return loginRecovery2.setup(this.ctx, this.login, questions, answers, callback)
}

Account.prototype.setupRecovery2Questions = Account.prototype.recovery2Set

Account.prototype.isLoggedIn = function () {
  return this.loggedIn
}

Account.prototype.sync = function (callback) {
  this.repo.sync(callback)
}

exports.Account = Account

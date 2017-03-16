import { findAccount } from './login/login.js'
import * as loginPassword from './login/password.js'
import * as loginPin2 from './login/pin2.js'
import * as loginRecovery2 from './login/recovery2.js'
import * as server from './login/server.js'
import {nodeify} from './util/decorators.js'
import { base16, base58 } from './util/encoding.js'
import {Repo} from './util/repo.js'
import {Wallet} from './wallet.js'
import {WalletList} from './util/walletList.js'

/**
 * This is a thin shim object,
 * which wraps the core implementation in a more OOP-style API.
 */
export function Account (ctx, login) {
  this.io = ctx.io
  this.login = login
  this.keys = findAccount(login, ctx.accountType)
  this.repoInfo = this.keys // Deprecated name
  this.loggedIn = true
  this.edgeLogin = false
  this.pinLogin = false
  this.passwordLogin = false
  this.newAccount = false
  this.recoveryLogin = false
  this.username = login.username

  this.repo = new Repo(this.io, base16.parse(this.keys.dataKey), base16.parse(this.keys.syncKey))
  this.walletList = new WalletList(this.repo)
}

Account.prototype.logout = function () {
  this.login = null
  this.loggedIn = false
}

Account.prototype.passwordOk = nodeify(function (password) {
  return loginPassword.check(this.io, this.login, password)
})
Account.prototype.checkPassword = Account.prototype.passwordOk

Account.prototype.passwordSetup = nodeify(function (password) {
  return loginPassword.setup(this.io, this.login, password)
})
Account.prototype.changePassword = Account.prototype.passwordSetup

Account.prototype.pinSetup = nodeify(function (pin) {
  return loginPin2
    .setup(this.io, this.login, pin)
    .then(login => base58.stringify(login.pin2Key))
})
Account.prototype.changePIN = Account.prototype.pinSetup

Account.prototype.recovery2Set = nodeify(function (questions, answers) {
  return loginRecovery2
    .setup(this.io, this.login, questions, answers)
    .then(login => base58.stringify(login.recovery2Key))
})

Account.prototype.setupRecovery2Questions = Account.prototype.recovery2Set

Account.prototype.isLoggedIn = function () {
  return this.loggedIn
}

Account.prototype.sync = nodeify(function () {
  return this.repo.sync().then(changed => {
    if (changed) {
      this.walletList.load()
    }
    return changed
  })
})

Account.prototype.listWalletIds = function () {
  return this.walletList.listIds()
}

Account.prototype.getWallet = function (id) {
  return new Wallet(this.walletList.getType(id), this.walletList.getKeys(id))
}

/**
 * Gets the first wallet in an account (the first by sort order).
 * If type is a string, finds the first wallet with the same type.
 * Might return null if there are no wallets.
 */
Account.prototype.getFirstWallet = function (type) {
  const id = this.walletList.listIds().find(
    id => type == null || this.walletList.getType(id) === type
  )
  return id ? this.getWallet(id) : null
}

/**
 * Creates a new wallet repo, and attaches it to the account.
 * @param keysJson An object with any user-provided keys
 * that should be stored along with the wallet. For example,
 * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
 */
Account.prototype.createWallet = nodeify(function (type, keysJson) {
  return server.repoCreate(this.io, this.login, keysJson).then(keysJson => {
    const id = this.walletList.addWallet(type, keysJson)
    return this.sync().then(dirty => {
      return server.repoActivate(this.io, this.login, keysJson).then(() => id)
    })
  })
})

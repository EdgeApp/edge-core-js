import { createChildLogin } from './login/create.js'
import { attachKeys, makeKeyInfo, searchTree } from './login/login.js'
import * as loginPassword from './login/password.js'
import * as loginPin2 from './login/pin2.js'
import * as loginRecovery2 from './login/recovery2.js'
import {nodeify} from './util/decorators.js'
import { base58, base64 } from './util/encoding.js'
import {Repo} from './util/repo.js'
import {Wallet} from './wallet.js'
import {WalletList} from './util/walletList.js'

function findAccount (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

export function makeAccountType (appId) {
  return appId === ''
    ? 'account-repo:co.airbitz.wallet'
    : `account-repo:${appId}`
}

function ensureAppIdExists (io, rootLogin, appId) {
  const login = searchTree(rootLogin, login => login.appId === appId)
  if (!login) {
    const accountType = makeAccountType(appId)
    const dataKey = io.random(32)
    const syncKey = io.random(20)
    const keyJson = {
      dataKey: base64.stringify(dataKey),
      syncKey: base64.stringify(syncKey)
    }
    const opts = {
      pin: rootLogin.pin,
      keyInfos: [makeKeyInfo(keyJson, accountType, dataKey)],
      newSyncKeys: [syncKey]
    }
    return createChildLogin(io, rootLogin, rootLogin, appId, opts).then(login => {
      return { rootLogin, login }
    })
  }

  return Promise.resolve({ rootLogin, login })
}

function ensureAccountRepoExists (io, rootLogin, login) {
  const accountType = makeAccountType(login.appId)
  if (findAccount(login, accountType) == null) {
    const dataKey = io.random(32)
    const syncKey = io.random(20)
    const keyJson = {
      dataKey: base64.stringify(dataKey),
      syncKey: base64.stringify(syncKey)
    }
    const keyInfo = makeKeyInfo(keyJson, accountType, dataKey)

    return attachKeys(io, rootLogin, login, [keyInfo], [syncKey])
  }

  return Promise.resolve()
}

export function makeAccount (ctx, rootLogin, loginType) {
  const { io, appId } = ctx

  return ensureAppIdExists(io, rootLogin, appId).then(value => {
    const { rootLogin, login } = value
    return ensureAccountRepoExists(io, rootLogin, login).then(() => {
      const account = new Account(ctx, rootLogin, login)
      account[loginType] = true
      return account.sync().then(dirty => account)
    })
  })
}

/**
 * This is a thin shim object,
 * which wraps the core implementation in a more OOP-style API.
 */
export function Account (ctx, rootLogin, login) {
  this.io = ctx.io

  // Login:
  this.username = rootLogin.username
  this.rootLogin = rootLogin
  this.login = login

  // Repo:
  this.type = makeAccountType(ctx.appId)
  const keyInfo = findAccount(this.login, this.type)
  if (keyInfo == null) {
    throw new Error(`Cannot find a "${this.type}" repo`)
  }
  this.keys = keyInfo.keys
  this.repoInfo = this.keys // Deprecated name

  // Flags:
  this.loggedIn = true
  this.edgeLogin = this.rootLogin.loginKey == null
  this.pinLogin = false
  this.passwordLogin = false
  this.newAccount = false
  this.recoveryLogin = false

  this.repo = new Repo(this.io, base64.parse(this.keys.dataKey), base64.parse(this.keys.syncKey))
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
  if (this.rootLogin.loginKey == null) {
    return Promise.reject(new Error('Edge logged-in account'))
  }
  return loginPassword.setup(this.io, this.rootLogin, this.rootLogin, password)
})
Account.prototype.changePassword = Account.prototype.passwordSetup

Account.prototype.pinSetup = nodeify(function (pin) {
  return loginPin2
    .setup(this.io, this.rootLogin, this.login, pin)
    .then(login => base58.stringify(login.pin2Key))
})
Account.prototype.changePIN = Account.prototype.pinSetup

Account.prototype.recovery2Set = nodeify(function (questions, answers) {
  if (this.rootLogin.loginKey == null) {
    return Promise.reject(new Error('Edge logged-in account'))
  }
  return loginRecovery2
    .setup(this.io, this.rootLogin, this.rootLogin, questions, answers)
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
  return this.login.keyInfos.map(info => info.id)
}

Account.prototype.getWallet = function (id) {
  const info = this.login.keyInfos.find(info => info.id === id)
  return info != null ? new Wallet(info.type, info.keys) : null
}

/**
 * Gets the first wallet in an account (the first by sort order).
 * If type is a string, finds the first wallet with the same type.
 * Might return null if there are no wallets.
 */
Account.prototype.getFirstWallet = function (type) {
  const info = this.login.keyInfos.find(info => info.type === type)
  return info != null ? new Wallet(info.type, info.keys) : null
}

/**
 * Creates a new wallet repo, and attaches it to the account.
 * @param keysJson An object with any user-provided keys
 * that should be stored along with the wallet. For example,
 * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
 */
Account.prototype.createWallet = nodeify(function (type, keysJson) {
  keysJson.dataKey = keysJson.dataKey || base64.stringify(this.io.random(32))
  keysJson.syncKey = keysJson.syncKey || base64.stringify(this.io.random(20))
  const dataKey = base64.parse(keysJson.dataKey)
  const syncKey = base64.parse(keysJson.syncKey)

  const info = makeKeyInfo(keysJson, type, dataKey)

  // We are just using this to create the repo, not to attach:
  return attachKeys(this.io, this.rootLogin, this.login, [info], [syncKey]).then(() => {
    return info.id
  })
})

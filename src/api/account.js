import { createChildLogin } from '../login/create.js'
import { attachKeys, makeAccountType, makeKeyInfo } from '../login/keys.js'
import { searchTree } from '../login/login.js'
import { checkPassword, setupPassword } from '../login/password.js'
import { setupPin2 } from '../login/pin2.js'
import { setupRecovery2 } from '../login/recovery2.js'
import { makeRepoFolder, syncRepo } from '../repo'
import { base58, base64 } from '../util/encoding.js'
import { Wallet } from './wallet.js'
import { wrapPrototype } from './wrap.js'

function findAccount (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

function ensureAppIdExists (io, loginTree, appId) {
  const login = searchTree(loginTree, login => login.appId === appId)
  if (!login) {
    const accountType = makeAccountType(appId)
    const dataKey = io.random(32)
    const syncKey = io.random(20)
    const keyJson = {
      dataKey: base64.stringify(dataKey),
      syncKey: base64.stringify(syncKey)
    }
    const opts = {
      pin: loginTree.pin,
      keyInfos: [makeKeyInfo(keyJson, accountType, dataKey)],
      newSyncKeys: [syncKey]
    }
    return createChildLogin(
      io,
      loginTree,
      loginTree,
      appId,
      opts
    ).then(login => {
      return { loginTree, login }
    })
  }

  return Promise.resolve({ loginTree, login })
}

function ensureAccountRepoExists (io, loginTree, login) {
  const accountType = makeAccountType(login.appId)
  if (findAccount(login, accountType) == null) {
    const dataKey = io.random(32)
    const syncKey = io.random(20)
    const keyJson = {
      dataKey: base64.stringify(dataKey),
      syncKey: base64.stringify(syncKey)
    }
    const keyInfo = makeKeyInfo(keyJson, accountType, dataKey)

    return attachKeys(io, loginTree, login, [keyInfo], [syncKey])
  }

  return Promise.resolve(loginTree)
}

export function makeAccount (ctx, loginTree, loginType) {
  const { io, appId } = ctx

  return ensureAppIdExists(io, loginTree, appId).then(value => {
    const { loginTree, login } = value
    return ensureAccountRepoExists(io, loginTree, login).then(loginTree => {
      const login = searchTree(loginTree, login => login.appId === appId)
      const account = new Account(ctx, loginTree, login)
      account[loginType] = true
      return account.sync().then(dirty => account)
    })
  })
}

/**
 * This is a thin shim object,
 * which wraps the core implementation in a more OOP-style API.
 */
export function Account (ctx, loginTree, login) {
  this.io = ctx.io

  // Login:
  this.username = loginTree.username
  this.loginTree = loginTree
  this.login = login

  // Flags:
  this.loggedIn = true
  this.edgeLogin = this.loginTree.loginKey == null
  this.pinLogin = false
  this.passwordLogin = false
  this.newAccount = false
  this.recoveryLogin = false

  // Repo:
  this.type = makeAccountType(ctx.appId)
  const keyInfo = findAccount(this.login, this.type)
  if (keyInfo == null) {
    throw new Error(`Cannot find a "${this.type}" repo`)
  }
  this.repo = makeRepoFolder(this.io, keyInfo)
}

Account.prototype = wrapPrototype('Account', {
  '@logout': { sync: true },
  logout () {
    this.login = null
    this.loggedIn = false
  },

  passwordOk (password) {
    return checkPassword(this.io, this.loginTree, password)
  },

  passwordSetup (password) {
    if (this.loginTree.loginKey == null) {
      return Promise.reject(new Error('Edge logged-in account'))
    }
    return setupPassword(this.io, this.loginTree, this.loginTree, password)
  },

  pinSetup (pin) {
    return setupPin2(this.io, this.loginTree, this.login, pin).then(login =>
      base58.stringify(login.pin2Key)
    )
  },

  recovery2Set (questions, answers) {
    if (this.loginTree.loginKey == null) {
      return Promise.reject(new Error('Edge logged-in account'))
    }
    return setupRecovery2(
      this.io,
      this.loginTree,
      this.loginTree,
      questions,
      answers
    ).then(login => base58.stringify(login.recovery2Key))
  },

  '@isLoggedIn': { sync: true },
  isLoggedIn () {
    return this.loggedIn
  },

  sync () {
    const keyInfo = findAccount(this.login, this.type)
    if (keyInfo != null) {
      return syncRepo(this.io, keyInfo)
    }
    return Promise.resolve()
  },

  '@listWalletIds': { sync: true },
  listWalletIds () {
    return this.login.keyInfos.map(info => info.id)
  },

  '@getWallet': { sync: true },
  getWallet (id) {
    const info = this.login.keyInfos.find(info => info.id === id)
    return info != null ? new Wallet(info.type, info.keys) : null
  },

  /**
   * Gets the first wallet in an account (the first by sort order).
   * If type is a string, finds the first wallet with the same type.
   * Might return null if there are no wallets.
   */
  '@getFirstWallet': { sync: true },
  getFirstWallet (type) {
    const info = this.login.keyInfos.find(info => info.type === type)
    return info != null ? new Wallet(info.type, info.keys) : null
  },

  /**
   * Creates a new wallet repo, and attaches it to the account.
   * @param keysJson An object with any user-provided keys
   * that should be stored along with the wallet. For example,
   * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
   */
  createWallet (type, keysJson) {
    keysJson.dataKey = keysJson.dataKey || base64.stringify(this.io.random(32))
    keysJson.syncKey = keysJson.syncKey || base64.stringify(this.io.random(20))
    const dataKey = base64.parse(keysJson.dataKey)
    const syncKey = base64.parse(keysJson.syncKey)

    const info = makeKeyInfo(keysJson, type, dataKey)

    // We are just using this to create the repo, not to attach:
    return attachKeys(
      this.io,
      this.loginTree,
      this.login,
      [info],
      [syncKey]
    ).then(() => {
      return info.id
    })
  }
})

Account.prototype.checkPassword = Account.prototype.passwordOk
Account.prototype.changePassword = Account.prototype.passwordSetup
Account.prototype.changePIN = Account.prototype.pinSetup
Account.prototype.setupRecovery2Questions = Account.prototype.recovery2Set

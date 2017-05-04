import { createChildLogin } from '../login/create.js'
import { makeAccountType, makeRepoKit } from '../login/keys.js'
import { dispatchKit, searchTree } from '../login/login.js'
import { checkPassword, setupPassword } from '../login/password.js'
import { setupPin2 } from '../login/pin2.js'
import { setupRecovery2 } from '../login/recovery2.js'
import { makeRepoFolder, syncRepo } from '../repo'
import { base58 } from '../util/encoding.js'
import { Wallet } from './wallet.js'
import { wrapPrototype } from './wrap.js'

function findAccount (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

function ensureAppIdExists (io, loginTree, appId) {
  const login = searchTree(loginTree, login => login.appId === appId)
  if (!login) {
    const accountType = makeAccountType(appId)
    const keysKit = makeRepoKit(io, login, accountType)

    const opts = { pin: loginTree.pin, keysKit }
    return createChildLogin(
      io,
      loginTree,
      loginTree,
      appId,
      opts
    ).then(loginTree => {
      return { loginTree, login }
    })
  }

  return Promise.resolve({ loginTree, login })
}

function ensureAccountRepoExists (io, loginTree, login) {
  const accountType = makeAccountType(login.appId)
  if (findAccount(login, accountType) == null) {
    const kit = makeRepoKit(io, login, accountType)

    return dispatchKit(io, loginTree, login, kit)
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
   * @param keys An object with any user-provided keys
   * that should be stored along with the wallet. For example,
   * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
   */
  createWallet (type, keys) {
    const kit = makeRepoKit(this.io, this.login, type, keys)

    return dispatchKit(
      this.io,
      this.loginTree,
      this.login,
      kit
    ).then(loginTree => {
      this.loginTree = loginTree
      this.login = searchTree(
        loginTree,
        login => login.appId === this.login.appId
      )
      return kit.login.keyInfos[0].id
    })
  }
})

Account.prototype.checkPassword = Account.prototype.passwordOk
Account.prototype.changePassword = Account.prototype.passwordSetup
Account.prototype.changePIN = Account.prototype.pinSetup
Account.prototype.setupRecovery2Questions = Account.prototype.recovery2Set

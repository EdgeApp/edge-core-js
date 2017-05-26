import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo
} from '../login/keys.js'
import { checkPassword } from '../login/password.js'
import { LoginState } from '../login/state.js'
import { makeRepoFolder, syncRepo } from '../repo'
import { base58 } from '../util/encoding.js'
import { Wallet } from './wallet.js'
import { wrapPrototype } from './wrap.js'

export function makeAccount (io, appId, loginTree, loginType = 'loggedIn') {
  const state = new LoginState(io, loginTree)
  return state
    .ensureLogin(appId)
    .then(() => state.ensureAccountRepo(state.findLogin(appId)))
    .then(() => {
      const account = new Account(io, appId, state)
      account[loginType] = true
      return account.sync().then(dirty => account)
    })
}

/**
 * This is a thin shim object,
 * which wraps the core implementation in a more OOP-style API.
 */
export function Account (io, appId, loginState) {
  this.io = io
  this.appId = appId
  this._state = loginState

  // Flags:
  this.loggedIn = true
  this.pinLogin = false
  this.passwordLogin = false
  this.newAccount = false
  this.recoveryLogin = false

  // Repo:
  this.type = makeAccountType(appId)
  const keyInfo = findFirstKey(this.login.keyInfos, this.type)
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

  get edgeLogin () {
    return this.loginTree.loginKey == null
  },
  get login () {
    return this._state.findLogin(this.appId)
  },
  get loginTree () {
    return this._state.loginTree
  },
  get username () {
    return this.loginTree.username
  },

  passwordOk (password) {
    return checkPassword(this.io, this.loginTree, password)
  },

  passwordSetup (password) {
    return this._state.changePassword(password)
  },

  pinSetup (pin) {
    return this._state
      .changePin(pin, this.login)
      .then(() => base58.stringify(this.loginTree.pin2Key))
  },

  recovery2Set (questions, answers) {
    return this._state
      .changeRecovery(questions, answers)
      .then(() => base58.stringify(this.loginTree.recovery2Key))
  },

  '@isLoggedIn': { sync: true },
  isLoggedIn () {
    return this.loggedIn
  },

  sync () {
    const keyInfo = findFirstKey(this.login.keyInfos, this.type)
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
    const info = findFirstKey(this.login.keyInfos, type)
    return info != null ? new Wallet(info.type, info.keys) : null
  },

  /**
   * Creates a new wallet repo, and attaches it to the account.
   * @param keys An object with any user-provided keys
   * that should be stored along with the wallet. For example,
   * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
   */
  createWallet (type, keys) {
    const keyInfo = makeStorageKeyInfo(this.io, type, keys)
    const kit = makeKeysKit(this.io, this.login, keyInfo)
    return this._state.applyKit(kit).then(() => keyInfo.id)
  }
})

Account.prototype.checkPassword = Account.prototype.passwordOk
Account.prototype.changePassword = Account.prototype.passwordSetup
Account.prototype.changePIN = Account.prototype.pinSetup
Account.prototype.setupRecovery2Questions = Account.prototype.recovery2Set

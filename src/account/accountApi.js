import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo
} from '../login/keys.js'
import { checkPassword } from '../login/password.js'
import { LoginState } from '../login/state.js'
import { makeRepoFolder, syncRepo } from '../repo'
import { wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'

/**
 * Creates an `Account` API object, setting up any missing prerequisites.
 */
export function makeAccount (io, appId, loginTree, loginType) {
  const state = new LoginState(io, loginTree)
  return state
    .ensureLogin(appId)
    .then(() => state.ensureAccountRepo(state.findLogin(appId)))
    .then(() => {
      const account = makeAccountInner(io, appId, state, loginType)
      return account.sync().then(dirty => wrapObject(io.log, 'Account', account))
    })
}

/**
 * Creates an `Account` API object,
 * assuming all the prerequisites are present (proper appId, account repo).
 */
export function makeAccountInner (io, appId, state, loginType) {
  // Find repo keys:
  const login = state.findLogin(appId)
  const type = makeAccountType(appId)
  const keyInfo = findFirstKey(login.keyInfos, type)
  if (keyInfo == null) {
    throw new Error(`Cannot find a "${type}" repo`)
  }
  const folder = makeRepoFolder(io, keyInfo)

  const out = {
    // Immutable info:
    appId,
    type,
    folder,

    // These change dynamically as the login is modified:
    get login () {
      return state.findLogin(appId)
    },
    get loginTree () {
      return state.loginTree
    },
    get usernname () {
      return state.loginTree.username
    },

    // Flags:
    get loggedIn () {
      return state.loginTree != null
    },
    pinLogin: loginType === 'pinLogin',
    passwordLogin: loginType === 'passwordLogin',
    newAccount: loginType === 'newAccount',
    recoveryLogin: loginType === 'recoveryLogin',
    get edgeLogin () {
      return state.loginTree.loginKey == null
    },
    '@isLoggedIn': { sync: true },
    isLoggedIn () {
      return state.loginTree != null
    },

    logout () {
      state.loginTree = null
    },

    passwordOk (password) {
      return checkPassword(io, state.loginTree, password)
    },

    passwordSetup (password) {
      return state.changePassword(password)
    },

    pinSetup (pin) {
      return state
        .changePin(pin, this.login)
        .then(() => base58.stringify(this.login.pin2Key))
    },

    recovery2Set (questions, answers) {
      return state
        .changeRecovery(questions, answers)
        .then(() => base58.stringify(state.loginTree.recovery2Key))
    },

    sync () {
      return syncRepo(io, keyInfo)
    },

    '@listWalletIds': { sync: true },
    listWalletIds () {
      return this.login.keyInfos.map(info => info.id)
    },

    '@getWallet': { sync: true },
    getWallet (id) {
      const info = this.login.keyInfos.find(info => info.id === id)
      return info
    },

    /**
     * Gets the first wallet in an account (the first by sort order).
     * If type is a string, finds the first wallet with the same type.
     * Might return null if there are no wallets.
     */
    '@getFirstWallet': { sync: true },
    getFirstWallet (type) {
      return findFirstKey(this.login.keyInfos, type)
    },

    /**
     * Creates a new wallet repo, and attaches it to the account.
     * @param keys An object with any user-provided keys
     * that should be stored along with the wallet. For example,
     * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
     */
    createWallet (type, keys) {
      const keyInfo = makeStorageKeyInfo(io, type, keys)
      const kit = makeKeysKit(io, this.login, keyInfo)
      return state.applyKit(kit).then(() => keyInfo.id)
    }
  }

  out.checkPassword = out.passwordOk
  out.changePassword = out.passwordSetup
  out.changePIN = out.pinSetup
  out.setupRecovery2Questions = out.recovery2Set

  return out
}

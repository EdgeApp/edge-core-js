import {
  findFirstKey,
  makeKeysKit,
  makeStorageKeyInfo,
  mergeKeyInfos
} from '../login/keys.js'
import { checkPassword } from '../login/password.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'
import { softCat } from '../util/util.js'
import { makeAccountState } from './accountState.js'

/**
 * Creates an `Account` API object.
 */
export function makeAccount (io, appId, loginTree, loginType) {
  return makeAccountState(io, appId, loginTree).then(state =>
    wrapObject(io.console, 'Account', makeAccountApi(state, loginType))
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
function makeAccountApi (state, loginType) {
  const { io, appId, storage } = state

  const out = {
    // Immutable info:
    appId,

    // These change dynamically as the login is modified:
    get login () {
      return state.login
    },
    get loginTree () {
      return state.loginTree
    },
    get username () {
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
      state.logout()
    },

    passwordOk (password) {
      return checkPassword(io, state.loginTree, password)
    },

    passwordSetup (password) {
      return state.changePassword(password)
    },

    pinSetup (pin) {
      return state
        .changePin(pin)
        .then(() => base58.stringify(state.login.pin2Key))
    },

    recovery2Set (questions, answers) {
      return state
        .changeRecovery(questions, answers)
        .then(() => base58.stringify(state.loginTree.recovery2Key))
    },

    /**
     * Retrieves all the keys that are available to this login object.
     */
    get allKeys () {
      const { keyStates, legacyKeyInfos, login } = state
      const allKeys = mergeKeyInfos(softCat(legacyKeyInfos, login.keyInfos))

      return allKeys.map(info => ({
        appId,
        archived: false,
        deleted: false,
        sortIndex: allKeys.length,
        ...keyStates[info.id],
        ...info
      }))
    },

    /**
     * Adjusts the sort, archive, or deletion state of keys.
     */
    changeKeyStates (keyStates) {
      return state.changeKeyStates(keyStates)
    },

    '@listWalletIds': { sync: true },
    listWalletIds () {
      return state.login.keyInfos.map(info => info.id)
    },

    '@getWallet': { sync: true },
    getWallet (id) {
      const info = state.login.keyInfos.find(info => info.id === id)
      return info
    },

    /**
     * Gets the first wallet in an account (the first by sort order).
     * If type is a string, finds the first wallet with the same type.
     * Might return null if there are no wallets.
     */
    '@getFirstWallet': { sync: true },
    getFirstWallet (type) {
      return findFirstKey(state.login.keyInfos, type)
    },

    /**
     * Creates a new wallet repo, and attaches it to the account.
     * @param keys An object with any user-provided keys
     * that should be stored along with the wallet. For example,
     * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
     */
    createWallet (type, keys) {
      const keyInfo = makeStorageKeyInfo(io, type, keys)
      const kit = makeKeysKit(io, state.login, keyInfo)
      return state.applyKit(kit).then(() => keyInfo.id)
    }
  }
  copyProperties(out, makeStorageWalletApi(storage))

  out.checkPassword = out.passwordOk
  out.changePassword = out.passwordSetup
  out.changePIN = out.pinSetup
  out.setupRecovery2Questions = out.recovery2Set

  return out
}

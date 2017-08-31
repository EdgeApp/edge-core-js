// @flow
import {
  findFirstKey,
  makeKeysKit,
  makeStorageKeyInfo,
  mergeKeyInfos
} from '../login/keys.js'
import type {
  AbcWalletStates,
  AbcWalletInfo,
  AbcAccount,
  AbcAccountCallbacks
} from '../abcTypes.js'
import { checkPassword } from '../login/password.js'
import { getCurrencyPlugin } from '../redux/selectors.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'
import { softCat } from '../util/util.js'
import { makeAccountState } from './accountState.js'
import { makeExchangeCache } from './exchangeApi.js'

/**
 * Creates an `Account` API object.
 */
export function makeAccount (io:any, appId:string, loginTree:any, loginType:string = '', callbacks:AbcAccountCallbacks|{} = {}) {
  return makeAccountState(io, appId, loginTree).then(state =>
    wrapObject(
      io.onError,
      'Account',
      makeAccountApi(state, loginType, callbacks)
    )
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
function makeAccountApi (state:any, loginType:string, callbacks:AbcAccountCallbacks|{}):AbcAccount {
  const { io, appId, keyInfo } = state
  const { redux } = io

  const exchangeCache = makeExchangeCache(io)

  const abcAccount:AbcAccount = {
    get appId ():string {
      return state.login.appId
    },
    get username ():string {
      return state.loginTree.username
    },
    get loginKey ():string {
      return base58.stringify(state.login.loginKey)
    },

    // Exchange cache:
    get exchangeCache ():any {
      return exchangeCache
    },

    // Flags:
    get loggedIn ():boolean {
      return state.loginTree != null
    },
    keyLogin: loginType === 'keyLogin',
    pinLogin: loginType === 'pinLogin',
    passwordLogin: loginType === 'passwordLogin',
    newAccount: loginType === 'newAccount',
    recoveryLogin: loginType === 'recoveryLogin',
    get edgeLogin ():boolean {
      return state.loginTree.loginKey == null
    },
    '@isLoggedIn': { sync: true },
    isLoggedIn ():boolean {
      return state.loginTree != null
    },

    logout ():Promise<void> {
      return state.logout()
    },

    passwordOk (password:string):Promise<boolean> {
      return checkPassword(io, state.loginTree, password)
    },

    passwordSetup (password:string):Promise<void> {
      return state.changePassword(password)
    },

    pinSetup (pin:string):Promise<void> {
      return state
        .changePin(pin)
        .then(() => base58.stringify(state.login.pin2Key))
    },

    recovery2Set (questions:string, answers:string):Promise<string> {
      return state
        .changeRecovery(questions, answers)
        .then(() => base58.stringify(state.loginTree.recovery2Key))
    },

    /**
     * Retrieves all the keys that are available to this login object.
     */
    get allKeys ():Array<any> {
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
    changeWalletStates (walletStates:AbcWalletStates):Promise<void> {
      return state.changeKeyStates(walletStates)
    },

    '@listWalletIds': { sync: true },
    listWalletIds ():Array<string> {
      return state.login.keyInfos.map(info => info.id)
    },

    '@getWallet': { sync: true },
    getWallet (id:string):AbcWalletInfo {
      const info = state.login.keyInfos.find(info => info.id === id)
      return info
    },

    /**
     * Gets the first wallet in an account (the first by sort order).
     * If type is a string, finds the first wallet with the same type.
     * Might return null if there are no wallets.
     */
    '@getFirstWallet': { sync: true },
    getFirstWallet (type:string):AbcWalletInfo {
      return findFirstKey(this.allKeys, type)
    },

    /**
     * Creates a new wallet repo, and attaches it to the account.
     * @param keys An object with any user-provided keys
     * that should be stored along with the wallet. For example,
     * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
     */
    createWallet (type:string, keys:any):string {
      if (keys == null) {
        // Use the currency plugin to create the keys:
        const plugin = getCurrencyPlugin(redux.getState(), type)
        keys = plugin.createPrivateKey(type)
      }

      const keyInfo = makeStorageKeyInfo(io, type, keys)
      const kit = makeKeysKit(io, state.login, keyInfo)
      return state.applyKit(kit).then(() => keyInfo.id)
    },

    checkPassword (password:string):Promise<boolean> { return this.passwordOk(password) },
    changePassword (password:string):Promise<void> { return this.passwordSetup(password) },
    changePIN (pin:string):Promise<void> { return this.pinSetup(pin) },
    setupRecovery2Questions (questions:string, answers:string):Promise<string> { return this.recovery2Set(questions, answers) },
    changeKeyStates (walletStates:AbcWalletStates):Promise<void> { return this.changeWalletStates(walletStates) },
    getFirstWalletInfo (type:string):AbcWalletInfo { return this.getFirstWallet(type) },
    getWalletInfo (id:string):AbcWalletInfo { return this.getWallet(id) }
  }
  copyProperties(abcAccount, makeStorageWalletApi(io.redux, keyInfo, callbacks))

  return abcAccount
}

// @flow
import type { CoreRoot } from '../coreRoot.js'
import { findFirstKey, makeKeysKit, makeStorageKeyInfo } from '../login/keys.js'
import { checkPassword } from '../login/password.js'
import { getCurrencyPlugin } from '../redux/selectors.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { base58 } from '../util/encoding.js'
import { makeAccountState } from './accountState.js'
import { makeExchangeCache } from './exchangeApi.js'
import type {
  AbcAccount,
  AbcAccountCallbacks,
  AbcWalletInfo,
  AbcWalletStates
} from 'airbitz-core-types'

/**
 * Creates an `Account` API object.
 */
export function makeAccount (
  coreRoot: CoreRoot,
  appId: string,
  loginTree: any,
  loginType: string = '',
  callbacks: AbcAccountCallbacks | {} = {}
) {
  return makeAccountState(coreRoot, appId, loginTree, callbacks).then(state =>
    wrapObject(
      coreRoot.onError,
      'Account',
      makeAccountApi(state, loginType, callbacks)
    )
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
function makeAccountApi (
  state: any,
  loginType: string,
  callbacks: AbcAccountCallbacks | {}
): AbcAccount {
  const { coreRoot, keyInfo } = state
  const { redux } = coreRoot

  const exchangeCache = makeExchangeCache(coreRoot)

  const abcAccount: AbcAccount = {
    get appId (): string {
      return state.login.appId
    },
    get username (): string {
      return state.loginTree.username
    },
    get loginKey (): string {
      return base58.stringify(state.login.loginKey)
    },

    // Exchange cache:
    get exchangeCache (): any {
      return exchangeCache
    },

    // Flags:
    get loggedIn (): boolean {
      return state.loginTree != null
    },
    keyLogin: loginType === 'keyLogin',
    pinLogin: loginType === 'pinLogin',
    passwordLogin: loginType === 'passwordLogin',
    newAccount: loginType === 'newAccount',
    recoveryLogin: loginType === 'recoveryLogin',
    get edgeLogin (): boolean {
      return state.loginTree.loginKey == null
    },
    '@isLoggedIn': { sync: true },
    isLoggedIn (): boolean {
      return state.loginTree != null
    },

    logout (): Promise<void> {
      return state.logout()
    },

    passwordOk (password: string): Promise<boolean> {
      return checkPassword(coreRoot, state.loginTree, password)
    },

    passwordSetup (password: string): Promise<void> {
      return state.changePassword(password)
    },

    pinSetup (pin: string): Promise<void> {
      return state
        .changePin(pin)
        .then(() => base58.stringify(state.login.pin2Key))
    },

    recovery2Set (
      questions: Array<string>,
      answers: Array<string>
    ): Promise<string> {
      return state
        .changeRecovery(questions, answers)
        .then(() => base58.stringify(state.loginTree.recovery2Key))
    },

    /**
     * Retrieves all the keys that are available to this login object.
     */
    get allKeys (): Array<any> {
      return state.allKeys
    },

    /**
     * Adjusts the sort, archive, or deletion state of keys.
     */
    changeWalletStates (walletStates: AbcWalletStates): Promise<void> {
      return state.changeKeyStates(walletStates)
    },

    '@listWalletIds': { sync: true },
    listWalletIds (): Array<string> {
      return state.login.keyInfos.map(info => info.id)
    },

    '@getWallet': { sync: true },
    getWallet (id: string): AbcWalletInfo {
      const info = state.login.keyInfos.find(info => info.id === id)
      return info
    },

    /**
     * Gets the first wallet in an account (the first by sort order).
     * If type is a string, finds the first wallet with the same type.
     * Might return null if there are no wallets.
     */
    '@getFirstWallet': { sync: true },
    getFirstWallet (type: string): AbcWalletInfo {
      return findFirstKey(this.allKeys, type)
    },

    /**
     * Creates a new wallet repo, and attaches it to the account.
     * @param keys An object with any user-provided keys
     * that should be stored along with the wallet. For example,
     * Airbitz Bitcoin wallets would place their `bitcoinKey` here.
     */
    createWallet (type: string, keys: any): string {
      if (keys == null) {
        // Use the currency plugin to create the keys:
        const plugin = getCurrencyPlugin(redux.getState(), type)
        keys = plugin.createPrivateKey(type)
      }

      const keyInfo = makeStorageKeyInfo(coreRoot, type, keys)
      const kit = makeKeysKit(coreRoot, state.login, keyInfo)
      return state.applyKit(kit).then(() => keyInfo.id)
    },

    // Core-managed wallets:
    get activeWalletIds (): Array<string> {
      return state.activeWalletIds
    },
    get archivedWalletIds (): Array<string> {
      return state.archivedWalletIds
    },
    get currencyWallets (): { [walletId: string]: {} } {
      // TODO: Return a map of AbcCurrencyWallets ^^
      return state.currencyWallets
    },

    // Name aliases:
    checkPassword (password: string): Promise<boolean> {
      return this.passwordOk(password)
    },
    changePassword (password: string): Promise<void> {
      return this.passwordSetup(password)
    },
    changePIN (pin: string): Promise<void> {
      return this.pinSetup(pin)
    },
    setupRecovery2Questions (
      questions: Array<string>,
      answers: Array<string>
    ): Promise<string> {
      return this.recovery2Set(questions, answers)
    },
    changeKeyStates (walletStates: AbcWalletStates): Promise<void> {
      return this.changeWalletStates(walletStates)
    },
    getFirstWalletInfo (type: string): AbcWalletInfo {
      return this.getFirstWallet(type)
    },
    getWalletInfo (id: string): AbcWalletInfo {
      return this.getWallet(id)
    }
  }
  copyProperties(
    abcAccount,
    makeStorageWalletApi(coreRoot.redux, keyInfo, callbacks)
  )

  return abcAccount
}

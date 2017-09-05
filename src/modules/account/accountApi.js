// @flow
import type {
  AbcAccount,
  AbcAccountCallbacks,
  AbcCreateCurrencyWalletOptions,
  AbcCurrencyWallet,
  AbcWalletInfo,
  AbcWalletStates
} from 'airbitz-core-types'
import { copyProperties, wrapObject } from '../../util/api.js'
import { base58 } from '../../util/encoding.js'
import { makeExchangeCache } from '../exchange/exchangeApi.js'
import { findFirstKey, makeKeysKit, makeStorageKeyInfo } from '../login/keys.js'
import { checkPassword } from '../login/password.js'
import type { ApiInput } from '../root.js'
import { getCurrencyPlugin } from '../selectors.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { makeAccountState } from './accountState.js'

/**
 * Creates an `Account` API object.
 */
export function makeAccount (
  ai: ApiInput,
  appId: string,
  loginTree: any,
  loginType: string = '',
  callbacks: AbcAccountCallbacks | {} = {}
) {
  return makeAccountState(ai, appId, loginTree, callbacks).then(state =>
    wrapObject(
      ai.props.onError,
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
  const { ai, keyInfo } = state

  const exchangeCache = makeExchangeCache(ai)

  const rawAccount: AbcAccount = {
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
      return checkPassword(ai, state.loginTree, password)
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
     * Might return undefined if there are no wallets.
     */
    '@getFirstWallet': { sync: true },
    getFirstWallet (type: string): ?AbcWalletInfo {
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
        const plugin = getCurrencyPlugin(ai.props.state, type)
        keys = plugin.createPrivateKey(type)
      }

      const keyInfo = makeStorageKeyInfo(ai, type, keys)
      const kit = makeKeysKit(ai, state.login, keyInfo)
      return state.applyKit(kit).then(() => keyInfo.id)
    },

    async createCurrencyWallet (
      type: string,
      opts?: AbcCreateCurrencyWalletOptions = {}
    ) {
      return state.createCurrencyWallet(type, opts)
    },

    // Core-managed wallets:
    '@activeWalletIds': { sync: true },
    get activeWalletIds (): Array<string> {
      return state.activeWalletIds
    },

    '@archivedWalletIds': { sync: true },
    get archivedWalletIds (): Array<string> {
      return state.archivedWalletIds
    },

    '@currencyWallets': { sync: true },
    get currencyWallets (): { [walletId: string]: AbcCurrencyWallet } {
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
    '@getFirstWalletInfo': { sync: true },
    getFirstWalletInfo (type: string): AbcWalletInfo {
      return this.getFirstWallet(type)
    },
    '@getWalletInfo': { sync: true },
    getWalletInfo (id: string): AbcWalletInfo {
      return this.getWallet(id)
    }
  }

  copyProperties(rawAccount, makeStorageWalletApi(ai, keyInfo, callbacks))

  return rawAccount
}

// @flow

import type {
  EdgeAccount,
  EdgeAccountCallbacks,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyToolsMap,
  EdgeCurrencyWallet,
  EdgeLobby,
  EdgePluginData,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../edge-core-index.js'
import { copyProperties, wrapObject } from '../../util/api.js'
import { base58 } from '../../util/encoding.js'
import { getCurrencyPlugin } from '../currency/currency-selectors.js'
import { makeExchangeCache } from '../exchange/exchange-api.js'
import { findFirstKey, makeKeysKit, makeStorageKeyInfo } from '../login/keys.js'
import type { LoginTree } from '../login/login-types.js'
import { checkPassword } from '../login/password.js'
import { checkPin2 } from '../login/pin2.js'
import type { ApiInput } from '../root.js'
import { makeStorageWalletApi } from '../storage/storage-api.js'
import { AccountState, makeAccountState } from './account-state.js'
import { makeLobbyApi } from './lobby-api.js'
import { makePluginDataApi } from './plugin-data-api.js'

/**
 * Creates an `Account` API object.
 */
export function makeAccount (
  ai: ApiInput,
  appId: string,
  loginTree: LoginTree,
  loginType: string = '',
  callbacks: EdgeAccountCallbacks = {}
) {
  return makeAccountState(ai, appId, loginTree, callbacks).then(state =>
    wrapObject('Account', makeAccountApi(state, loginType, callbacks))
  )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
function makeAccountApi (
  state: AccountState,
  loginType: string,
  callbacks: EdgeAccountCallbacks
): EdgeAccount {
  const ai: ApiInput = state.ai
  const { activeLoginId, accountWalletInfo } = state

  const exchangeCache = makeExchangeCache(ai)
  const pluginData = makePluginDataApi(ai, state)

  const rawAccount: EdgeAccount = {
    // Basic login information:
    get appId (): string {
      return state.login.appId
    },
    get loggedIn (): boolean {
      return state.loginTree != null
    },
    get loginKey (): string {
      return base58.stringify(state.login.loginKey)
    },
    get recoveryKey (): string | void {
      return state.login.recovery2Key != null
        ? base58.stringify(state.login.recovery2Key)
        : void 0
    },
    get username (): string {
      if (!state.loginTree.username) throw new Error('Missing username')
      return state.loginTree.username
    },

    // Speciality API's:
    get currencyTools (): EdgeCurrencyToolsMap {
      return state.currencyTools
    },
    get exchangeCache (): any {
      return exchangeCache
    },
    get pluginData (): EdgePluginData {
      return pluginData
    },

    // What login method was used?
    get edgeLogin (): boolean {
      return state.loginTree.loginKey == null
    },
    keyLogin: loginType === 'keyLogin',
    newAccount: loginType === 'newAccount',
    passwordLogin: loginType === 'passwordLogin',
    pinLogin: loginType === 'pinLogin',
    recoveryLogin: loginType === 'recoveryLogin',

    // Change or create credentials:
    changePassword (password: string): Promise<mixed> {
      return state.changePassword(password).then(() => {})
    },
    changePin (opts: {
      pin?: string, // We keep the existing PIN if unspecified
      enableLogin?: boolean // We default to true if unspecified
    }): Promise<string> {
      const { pin, enableLogin } = opts
      return state.changePin(pin, enableLogin).then(() => {
        return state.login.pin2Key ? base58.stringify(state.login.pin2Key) : ''
      })
    },
    changeRecovery (
      questions: Array<string>,
      answers: Array<string>
    ): Promise<string> {
      return state.changeRecovery(questions, answers).then(() => {
        if (!state.loginTree.recovery2Key) {
          throw new Error('Missing recoveryKey')
        }
        return base58.stringify(state.loginTree.recovery2Key)
      })
    },

    // Verify existing credentials:
    checkPassword (password: string): Promise<boolean> {
      return checkPassword(ai, state.loginTree, password)
    },
    checkPin (pin: string): Promise<boolean> {
      // Try to check the PIN locally, then fall back on the server:
      return state.login.pin != null
        ? Promise.resolve(pin === state.login.pin)
        : checkPin2(ai, state.loginTree, pin)
    },

    // Remove credentials:
    deletePassword (): Promise<mixed> {
      return state.deletePassword().then(() => {})
    },
    deletePin (): Promise<mixed> {
      return state.deletePin().then(() => {})
    },
    deleteRecovery (): Promise<mixed> {
      return state.deleteRecovery().then(() => {})
    },

    // OTP:
    get otpKey (): string | void {
      return state.login.otpTimeout != null ? state.login.otpKey : void 0
    },
    get otpResetDate (): string | void {
      return state.login.otpResetDate
    },
    cancelOtpReset (): Promise<mixed> {
      return state.cancelOtpReset().then(() => {})
    },
    enableOtp (timeout: number = 7 * 24 * 60 * 60): Promise<mixed> {
      return state.enableOtp(timeout).then(() => {})
    },
    disableOtp (): Promise<mixed> {
      return state.disableOtp().then(() => {})
    },

    // Edge login approval:
    fetchLobby (lobbyId: string): Promise<EdgeLobby> {
      return makeLobbyApi(ai, lobbyId, state)
    },

    // Login management:
    logout (): Promise<mixed> {
      return state.logout()
    },

    // Master wallet list:
    get allKeys (): Array<EdgeWalletInfoFull> {
      return state.allKeys
    },
    changeWalletStates (walletStates: EdgeWalletStates): Promise<mixed> {
      return state.changeWalletStates(walletStates)
    },
    createWallet (type: string, keys: any): Promise<string> {
      if (keys == null) {
        // Use the currency plugin to create the keys:
        const plugin = getCurrencyPlugin(ai.props.output.currency.plugins, type)
        keys = plugin.createPrivateKey(type)
      }

      const walletInfo = makeStorageKeyInfo(ai, type, keys)
      const kit = makeKeysKit(ai, state.login, walletInfo)
      return state.applyKit(kit).then(() => walletInfo.id)
    },
    '@getFirstWalletInfo': { sync: true },
    getFirstWalletInfo (type: string): ?EdgeWalletInfo {
      const allKeys: any = state.allKeys // WalletInfoFull -> WalletInfo
      return findFirstKey(allKeys, type)
    },
    '@getWalletInfo': { sync: true },
    getWalletInfo (id: string): ?EdgeWalletInfo {
      const allKeys: any = state.allKeys // WalletInfoFull -> WalletInfo
      return allKeys.find(info => info.id === id)
    },
    '@listWalletIds': { sync: true },
    listWalletIds (): Array<string> {
      return state.login.keyInfos.map(info => info.id)
    },
    splitWalletInfo (walletId: string, newWalletType: string): Promise<string> {
      return state.splitWalletInfo(walletId, newWalletType)
    },
    listSplittableWalletTypes (walletId: string): Promise<Array<string>> {
      return state.listSplittableWalletTypes(walletId)
    },

    // Currency wallets:
    get activeWalletIds (): Array<string> {
      return ai.props.state.login.logins[activeLoginId].activeWalletIds
    },
    get archivedWalletIds (): Array<string> {
      return ai.props.state.login.logins[activeLoginId].archivedWalletIds
    },
    get currencyWallets (): { [walletId: string]: EdgeCurrencyWallet } {
      const allIds = ai.props.state.currency.currencyWalletIds
      const selfState = ai.props.state.login.logins[state.activeLoginId]
      const myIds = allIds.filter(id => id in selfState.allWalletInfos)

      const out = {}
      for (const walletId of myIds) {
        const api = ai.props.output.currency.wallets[walletId].api
        if (api) out[walletId] = api
      }

      return out
    },
    async createCurrencyWallet (
      type: string,
      opts?: EdgeCreateCurrencyWalletOptions = {}
    ): Promise<EdgeCurrencyWallet> {
      return state.createCurrencyWallet(type, opts)
    }
  }

  copyProperties(
    rawAccount,
    makeStorageWalletApi(ai, accountWalletInfo, callbacks)
  )

  return rawAccount
}

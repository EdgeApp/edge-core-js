// @flow

import type {
  DiskletFolder,
  EdgeAccount,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyToolsMap,
  EdgeCurrencyWallet,
  EdgeDataStore,
  EdgeExchangeCache,
  EdgeLobby,
  EdgePluginData,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../edge-core-index.js'
import { wrapObject } from '../../util/api.js'
import { base58 } from '../../util/encoding.js'
import { getCurrencyPlugin } from '../currency/currency-selectors.js'
import { makeExchangeCache } from '../exchange/exchange-api.js'
import {
  createCurrencyWallet,
  findFirstKey,
  listSplittableWalletTypes,
  makeKeysKit,
  makeStorageKeyInfo,
  splitWalletInfo
} from '../login/keys.js'
import { applyKit } from '../login/login.js'
import { cancelOtpReset, disableOtp, enableOtp } from '../login/otp.js'
import {
  changePassword,
  checkPassword,
  deletePassword
} from '../login/password.js'
import { changePin, checkPin2, deletePin } from '../login/pin2.js'
import { changeRecovery, deleteRecovery } from '../login/recovery2.js'
import type { ApiInput } from '../root.js'
import { makeStorageWalletApi } from '../storage/storage-api.js'
import { changeWalletStates } from './account-files.js'
import { makeDataStoreApi, makePluginDataApi } from './data-store-api.js'
import { makeLobbyApi } from './lobby-api.js'

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeAccountApi (
  ai: ApiInput,
  accountId: string,
  currencyTools: EdgeCurrencyToolsMap
): EdgeAccount {
  const selfState = () => ai.props.state.accounts[accountId]
  const { accountWalletInfo, loginType } = selfState()

  const exchangeCache = makeExchangeCache(ai)
  const dataStore = makeDataStoreApi(ai, accountId)
  const pluginData = makePluginDataApi(dataStore)
  const storageWalletApi = makeStorageWalletApi(ai, accountWalletInfo)

  const out: EdgeAccount = {
    // Data store:
    get id (): string {
      return storageWalletApi.id
    },
    get type (): string {
      return storageWalletApi.type
    },
    get keys (): Object {
      return storageWalletApi.keys
    },
    get folder (): DiskletFolder {
      return storageWalletApi.folder
    },
    get localFolder (): DiskletFolder {
      return storageWalletApi.localFolder
    },
    sync (): Promise<mixed> {
      return storageWalletApi.sync()
    },

    // Basic login information:
    get appId (): string {
      return selfState().login.appId
    },
    get loggedIn (): boolean {
      return selfState() != null
    },
    get loginKey (): string {
      return base58.stringify(selfState().login.loginKey)
    },
    get recoveryKey (): string | void {
      const { login } = selfState()
      return login.recovery2Key != null
        ? base58.stringify(login.recovery2Key)
        : void 0
    },
    get username (): string {
      const { loginTree } = selfState()
      if (!loginTree.username) throw new Error('Missing username')
      return loginTree.username
    },

    // Speciality API's:
    get currencyTools (): EdgeCurrencyToolsMap {
      return currencyTools
    },
    get exchangeCache (): EdgeExchangeCache {
      return exchangeCache
    },
    get dataStore (): EdgeDataStore {
      return dataStore
    },
    get pluginData (): EdgePluginData {
      return pluginData
    },

    // What login method was used?
    get edgeLogin (): boolean {
      const { loginTree } = selfState()
      return loginTree.loginKey == null
    },
    keyLogin: loginType === 'keyLogin',
    newAccount: loginType === 'newAccount',
    passwordLogin: loginType === 'passwordLogin',
    pinLogin: loginType === 'pinLogin',
    recoveryLogin: loginType === 'recoveryLogin',

    // Change or create credentials:
    changePassword (password: string): Promise<mixed> {
      return changePassword(ai, accountId, password).then(() => {})
    },
    changePin (opts: {
      pin?: string, // We keep the existing PIN if unspecified
      enableLogin?: boolean // We default to true if unspecified
    }): Promise<string> {
      const { pin, enableLogin } = opts
      return changePin(ai, accountId, pin, enableLogin).then(() => {
        const { login } = selfState()
        return login.pin2Key ? base58.stringify(login.pin2Key) : ''
      })
    },
    changeRecovery (
      questions: Array<string>,
      answers: Array<string>
    ): Promise<string> {
      return changeRecovery(ai, accountId, questions, answers).then(() => {
        const { loginTree } = selfState()
        if (!loginTree.recovery2Key) {
          throw new Error('Missing recoveryKey')
        }
        return base58.stringify(loginTree.recovery2Key)
      })
    },

    // Verify existing credentials:
    checkPassword (password: string): Promise<boolean> {
      const { loginTree } = selfState()
      return checkPassword(ai, loginTree, password)
    },
    checkPin (pin: string): Promise<boolean> {
      const { login, loginTree } = selfState()

      // Try to check the PIN locally, then fall back on the server:
      return login.pin != null
        ? Promise.resolve(pin === login.pin)
        : checkPin2(ai, loginTree, pin)
    },

    // Remove credentials:
    deletePassword (): Promise<mixed> {
      return deletePassword(ai, accountId).then(() => {})
    },
    deletePin (): Promise<mixed> {
      return deletePin(ai, accountId).then(() => {})
    },
    deleteRecovery (): Promise<mixed> {
      return deleteRecovery(ai, accountId).then(() => {})
    },

    // OTP:
    get otpKey (): string | void {
      const { login } = selfState()
      return login.otpTimeout != null ? login.otpKey : void 0
    },
    get otpResetDate (): string | void {
      const { login } = selfState()
      return login.otpResetDate
    },
    cancelOtpReset (): Promise<mixed> {
      return cancelOtpReset(ai, accountId).then(() => {})
    },
    enableOtp (timeout: number = 7 * 24 * 60 * 60): Promise<mixed> {
      return enableOtp(ai, accountId, timeout).then(() => {})
    },
    disableOtp (): Promise<mixed> {
      return disableOtp(ai, accountId).then(() => {})
    },

    // Edge login approval:
    fetchLobby (lobbyId: string): Promise<EdgeLobby> {
      return makeLobbyApi(ai, accountId, lobbyId)
    },

    // Login management:
    logout (): Promise<mixed> {
      ai.props.dispatch({ type: 'LOGOUT', payload: { accountId } })
      return Promise.resolve()
    },

    // Master wallet list:
    get allKeys (): Array<EdgeWalletInfoFull> {
      return ai.props.state.accounts[accountId].allWalletInfosFull
    },
    changeWalletStates (walletStates: EdgeWalletStates): Promise<mixed> {
      return changeWalletStates(ai, accountId, walletStates)
    },
    createWallet (type: string, keys: any): Promise<string> {
      const { login, loginTree } = selfState()

      if (keys == null) {
        // Use the currency plugin to create the keys:
        const plugin = getCurrencyPlugin(ai.props.output.currency.plugins, type)
        keys = plugin.createPrivateKey(type)
      }

      const walletInfo = makeStorageKeyInfo(ai, type, keys)
      const kit = makeKeysKit(ai, login, walletInfo)
      return applyKit(ai, loginTree, kit).then(() => walletInfo.id)
    },
    '@getFirstWalletInfo': { sync: true },
    getFirstWalletInfo (type: string): ?EdgeWalletInfo {
      const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
      return findFirstKey(allKeys, type)
    },
    '@getWalletInfo': { sync: true },
    getWalletInfo (id: string): ?EdgeWalletInfo {
      const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
      return allKeys.find(info => info.id === id)
    },
    '@listWalletIds': { sync: true },
    listWalletIds (): Array<string> {
      return this.allKeys.map(info => info.id)
    },
    splitWalletInfo (walletId: string, newWalletType: string): Promise<string> {
      return splitWalletInfo(ai, accountId, walletId, newWalletType)
    },
    listSplittableWalletTypes (walletId: string): Promise<Array<string>> {
      return listSplittableWalletTypes(ai, accountId, walletId)
    },

    // Currency wallets:
    get activeWalletIds (): Array<string> {
      return ai.props.state.accounts[accountId].activeWalletIds
    },
    get archivedWalletIds (): Array<string> {
      return ai.props.state.accounts[accountId].archivedWalletIds
    },
    get currencyWallets (): { [walletId: string]: EdgeCurrencyWallet } {
      const allIds = ai.props.state.currency.currencyWalletIds
      const selfState = ai.props.state.accounts[accountId]
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
      return createCurrencyWallet(ai, accountId, type, opts)
    }
  }

  return wrapObject('Account', out)
}

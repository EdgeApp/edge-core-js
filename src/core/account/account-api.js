// @flow

import { type Disklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { AccountSync } from '../../client-side.js'
import {
  type EdgeAccount,
  type EdgeCreateCurrencyWalletOptions,
  type EdgeCurrencyConfig,
  type EdgeCurrencyWallet,
  type EdgeDataStore,
  type EdgeLobby,
  type EdgePluginData,
  type EdgePluginMap,
  type EdgeRateCache,
  type EdgeSwapConfig,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeWalletInfoFull,
  type EdgeWalletStates,
  type EthereumTransaction,
  type JsonObject
} from '../../types/types.js'
import { signEthereumTransaction } from '../../util/crypto/ethereum.js'
import { signRequestTransaction } from '../../util/crypto/request.js'
import { deprecate } from '../../util/deprecate.js'
import { base58 } from '../../util/encoding.js'
import { makeExchangeCache } from '../exchange/exchange-api.js'
import {
  createCurrencyWallet,
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
import { getCurrencyTools } from '../plugins/plugins-selectors.js'
import { type ApiInput } from '../root-pixie.js'
import { makeStorageWalletApi } from '../storage/storage-api.js'
import { fetchSwapQuote } from '../swap/swap-api.js'
import { changeWalletStates } from './account-files.js'
import { makeDataStoreApi, makePluginDataApi } from './data-store-api.js'
import { makeLobbyApi } from './lobby-api.js'
import { CurrencyConfig, SwapConfig } from './plugin-api.js'

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeAccountApi(ai: ApiInput, accountId: string): EdgeAccount {
  const selfState = () => ai.props.state.accounts[accountId]
  const { accountWalletInfo, loginType, loginTree } = selfState()
  const { username } = loginTree

  // Plugin config API's:
  const currencyConfigs: EdgePluginMap<EdgeCurrencyConfig> = {}
  for (const pluginName in ai.props.state.plugins.currency) {
    const api = new CurrencyConfig(ai, accountId, pluginName)
    currencyConfigs[pluginName] = api
  }
  const swapConfigs: EdgePluginMap<EdgeSwapConfig> = {}
  for (const pluginName in ai.props.state.plugins.swap) {
    const api = new SwapConfig(ai, accountId, pluginName)
    swapConfigs[pluginName] = api
  }

  // Specialty API's:
  const rateCache = makeExchangeCache(ai)
  const dataStore = makeDataStoreApi(ai, accountId)
  const pluginData = makePluginDataApi(dataStore)
  const storageWalletApi = makeStorageWalletApi(ai, accountWalletInfo)

  function lockdown() {
    if (ai.props.state.hideKeys) {
      throw new Error('Not available when `hideKeys` is enabled')
    }
  }

  const out: EdgeAccount = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get id(): string {
      return storageWalletApi.id
    },
    get type(): string {
      return storageWalletApi.type
    },
    get keys(): JsonObject {
      lockdown()
      return storageWalletApi.keys
    },
    get disklet(): Disklet {
      lockdown()
      return storageWalletApi.disklet
    },
    get localDisklet(): Disklet {
      lockdown()
      return storageWalletApi.localDisklet
    },
    async sync(): Promise<mixed> {
      return storageWalletApi.sync()
    },

    // Basic login information:
    get appId(): string {
      return selfState().login.appId
    },
    get loggedIn(): boolean {
      return selfState() != null
    },
    get loginKey(): string {
      lockdown()
      return base58.stringify(selfState().login.loginKey)
    },
    get recoveryKey(): string | void {
      lockdown()
      const { login } = selfState()
      return login.recovery2Key != null
        ? base58.stringify(login.recovery2Key)
        : undefined
    },
    get username(): string {
      if (!username) throw new Error('Missing username')
      return username
    },

    // Speciality API's:
    get currencyConfig(): EdgePluginMap<EdgeCurrencyConfig> {
      return currencyConfigs
    },
    get swapConfig(): EdgePluginMap<EdgeSwapConfig> {
      return swapConfigs
    },
    get rateCache(): EdgeRateCache {
      return rateCache
    },
    get dataStore(): EdgeDataStore {
      return dataStore
    },

    // What login method was used?
    get edgeLogin(): boolean {
      const { loginTree } = selfState()
      return loginTree.loginKey == null
    },
    keyLogin: loginType === 'keyLogin',
    newAccount: loginType === 'newAccount',
    passwordLogin: loginType === 'passwordLogin',
    pinLogin: loginType === 'pinLogin',
    recoveryLogin: loginType === 'recoveryLogin',

    // Change or create credentials:
    async changePassword(password: string): Promise<mixed> {
      lockdown()
      return changePassword(ai, accountId, password).then(() => {})
    },
    async changePin(opts: {
      pin?: string, // We keep the existing PIN if unspecified
      enableLogin?: boolean // We default to true if unspecified
    }): Promise<string> {
      lockdown()
      const { pin, enableLogin } = opts
      return changePin(ai, accountId, pin, enableLogin).then(() => {
        const { login } = selfState()
        return login.pin2Key ? base58.stringify(login.pin2Key) : ''
      })
    },
    async changeRecovery(
      questions: string[],
      answers: string[]
    ): Promise<string> {
      lockdown()
      return changeRecovery(ai, accountId, questions, answers).then(() => {
        const { loginTree } = selfState()
        if (!loginTree.recovery2Key) {
          throw new Error('Missing recoveryKey')
        }
        return base58.stringify(loginTree.recovery2Key)
      })
    },

    // Verify existing credentials:
    async checkPassword(password: string): Promise<boolean> {
      lockdown()
      const { loginTree } = selfState()
      return checkPassword(ai, loginTree, password)
    },
    async checkPin(pin: string): Promise<boolean> {
      lockdown()
      const { login, loginTree } = selfState()

      // Try to check the PIN locally, then fall back on the server:
      return login.pin != null
        ? pin === login.pin
        : checkPin2(ai, loginTree, pin)
    },

    // Remove credentials:
    async deletePassword(): Promise<mixed> {
      lockdown()
      return deletePassword(ai, accountId).then(() => {})
    },
    async deletePin(): Promise<mixed> {
      lockdown()
      return deletePin(ai, accountId).then(() => {})
    },
    async deleteRecovery(): Promise<mixed> {
      lockdown()
      return deleteRecovery(ai, accountId).then(() => {})
    },

    // OTP:
    get otpKey(): string | void {
      lockdown()
      const { loginTree } = selfState()
      return loginTree.otpTimeout != null ? loginTree.otpKey : undefined
    },
    get otpResetDate(): string | void {
      lockdown()
      const { loginTree } = selfState()
      return loginTree.otpResetDate
    },
    async cancelOtpReset(): Promise<mixed> {
      lockdown()
      return cancelOtpReset(ai, accountId).then(() => {})
    },
    async enableOtp(timeout: number = 7 * 24 * 60 * 60): Promise<mixed> {
      lockdown()
      return enableOtp(ai, accountId, timeout).then(() => {})
    },
    async disableOtp(): Promise<mixed> {
      lockdown()
      return disableOtp(ai, accountId).then(() => {})
    },

    // Edge login approval:
    async fetchLobby(lobbyId: string): Promise<EdgeLobby> {
      lockdown()
      return makeLobbyApi(ai, accountId, lobbyId)
    },

    // Login management:
    async logout(): Promise<mixed> {
      ai.props.dispatch({ type: 'LOGOUT', payload: { accountId } })
    },

    // Master wallet list:
    get allKeys(): EdgeWalletInfoFull[] {
      return ai.props.state.hideKeys
        ? ai.props.state.accounts[accountId].allWalletInfosClean
        : ai.props.state.accounts[accountId].allWalletInfosFull
    },
    async changeWalletStates(walletStates: EdgeWalletStates): Promise<mixed> {
      return changeWalletStates(ai, accountId, walletStates)
    },

    async createWallet(walletType: string, keys?: JsonObject): Promise<string> {
      const { login, loginTree } = selfState()

      if (keys == null) {
        // Use the currency plugin to create the keys:
        const tools = await getCurrencyTools(ai, walletType)
        keys = await tools.createPrivateKey(walletType)
      }

      const walletInfo = makeStorageKeyInfo(ai, walletType, keys)

      const kit = makeKeysKit(ai, login, walletInfo)

      return applyKit(ai, loginTree, kit).then(() => walletInfo.id)
    },
    getFirstWalletInfo: AccountSync.prototype.getFirstWalletInfo,
    getWalletInfo: AccountSync.prototype.getWalletInfo,
    listWalletIds: AccountSync.prototype.listWalletIds,
    async splitWalletInfo(
      walletId: string,
      newWalletType: string
    ): Promise<string> {
      return splitWalletInfo(ai, accountId, walletId, newWalletType)
    },
    async listSplittableWalletTypes(walletId: string): Promise<string[]> {
      return listSplittableWalletTypes(ai, accountId, walletId)
    },

    // Currency wallets:
    get activeWalletIds(): string[] {
      return ai.props.state.accounts[accountId].activeWalletIds
    },
    get archivedWalletIds(): string[] {
      return ai.props.state.accounts[accountId].archivedWalletIds
    },
    get hiddenWalletIds(): string[] {
      return ai.props.state.accounts[accountId].hiddenWalletIds
    },
    get currencyWallets(): { [walletId: string]: EdgeCurrencyWallet } {
      return ai.props.output.accounts[accountId].currencyWallets
    },
    async createCurrencyWallet(
      type: string,
      opts: EdgeCreateCurrencyWalletOptions = {}
    ): Promise<EdgeCurrencyWallet> {
      return createCurrencyWallet(ai, accountId, type, opts)
    },
    async waitForCurrencyWallet(walletId: string): Promise<EdgeCurrencyWallet> {
      return new Promise(resolve => {
        const f = currencyWallets => {
          const wallet = this.currencyWallets[walletId]
          if (wallet != null) {
            resolve(wallet)
            unsubscribe()
          }
        }
        const unsubscribe = this.watch('currencyWallets', f)
        f()
      })
    },

    async signEthereumTransaction(
      walletId: string,
      transaction: EthereumTransaction
    ): Promise<string> {
      ai.props.log('Edge is signing: ', transaction)
      const { allWalletInfosFull } = selfState()
      const walletInfo = allWalletInfosFull.find(info => info.id === walletId)
      if (
        walletInfo == null ||
        walletInfo.keys == null ||
        typeof walletInfo.keys.ethereumKey !== 'string'
      ) {
        throw new Error('Cannot find the requested private key in the account')
      }
      return signEthereumTransaction(walletInfo.keys.ethereumKey, transaction)
    },

    async signRequestTransaction(
      walletId: string,
      transaction: any
    ): Promise<string> {
      ai.props.log('Edge is signing: ', transaction)
      const { allWalletInfosFull } = selfState()
      const walletInfo = allWalletInfosFull.find(info => info.id === walletId)
      if (
        walletInfo == null ||
        walletInfo.keys == null ||
        // TODO should we use a "requestKey" ?
        typeof walletInfo.keys.ethereumKey !== 'string'
      ) {
        throw new Error('Cannot find the requested private key in the account')
      }
      return signRequestTransaction(walletInfo.keys.ethereumKey, transaction)
    },

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      return fetchSwapQuote(ai, accountId, request)
    },

    // Deprecated names:
    get currencyTools(): EdgePluginMap<EdgeCurrencyConfig> {
      return currencyConfigs
    },
    get exchangeTools(): EdgePluginMap<EdgeSwapConfig> {
      return swapConfigs
    },
    get exchangeCache(): EdgeRateCache {
      return rateCache
    },
    get pluginData(): EdgePluginData {
      return pluginData
    },
    async getExchangeQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      deprecate('EdgeAccount.getExchangeQuote', 'EdgeAccount.fetchSwapQuote')
      return this.fetchSwapQuote(request)
    }
  }
  bridgifyObject(out)

  return out
}

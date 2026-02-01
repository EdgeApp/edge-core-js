import { Disklet } from 'disklet'
import { base32 } from 'rfc4648'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import { ChangeUsernameOptions } from '../../browser'
import { AccountSync, fixUsername } from '../../client-side'
import {
  ChangePinOptions,
  EdgeAccount,
  EdgeActivationOptions,
  EdgeActivationQuote,
  EdgeCreateCurrencyWallet,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyConfig,
  EdgeCurrencyWallet,
  EdgeDataStore,
  EdgeGetActivationAssetsOptions,
  EdgeGetActivationAssetsResults,
  EdgeLobby,
  EdgeMemoryWallet,
  EdgePendingVoucher,
  EdgePluginMap,
  EdgeResult,
  EdgeSwapConfig,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapRequestOptions,
  EdgeToken,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../types/types'
import { base58 } from '../../util/encoding'
import {
  CachedToken,
  CachedWallet,
  WalletCacheFile
} from '../cache/cache-wallet-cleaners'
import { WalletCacheSetup } from '../cache/cache-wallet-loader'
import { getPublicWalletInfo } from '../currency/wallet/currency-wallet-pixie'
import {
  finishWalletCreation,
  makeCurrencyWalletKeys,
  makeKeysKit
} from '../login/keys'
import { applyKit, decryptChildKey, searchTree } from '../login/login'
import { deleteLogin } from '../login/login-delete'
import { changeUsername } from '../login/login-username'
import {
  cancelOtpReset,
  disableOtp,
  disableTempOtp,
  enableOtp,
  enableTempOtp,
  repairOtp
} from '../login/otp'
import {
  changePassword,
  checkPassword,
  deletePassword
} from '../login/password'
import { changePin, checkPin2, deletePin } from '../login/pin2'
import { changeRecovery, deleteRecovery } from '../login/recovery2'
import { listSplittableWalletTypes, splitWalletInfo } from '../login/splitting'
import { changeVoucherStatus } from '../login/vouchers'
import {
  findCurrencyPluginId,
  getCurrencyTools
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { makeLocalDisklet } from '../storage/repo'
import { makeStorageWalletApi } from '../storage/storage-api'
import { fetchSwapQuotes } from '../swap/swap-api'
import { changeWalletStates } from './account-files'
import { ensureAccountExists } from './account-init'
import { AccountState } from './account-reducer'
import { makeDataStoreApi } from './data-store-api'
import { makeLobbyApi } from './lobby-api'
import { makeMemoryWalletInner } from './memory-wallet'
import { CurrencyConfig, SwapConfig } from './plugin-api'

/**
 * Converts an EdgeToken to the CachedToken format for caching.
 */
function edgeTokenToCachedToken(token: EdgeToken): CachedToken {
  return {
    currencyCode: token.currencyCode,
    displayName: token.displayName,
    denominations: token.denominations.map(d => ({
      multiplier: d.multiplier,
      name: d.name,
      symbol: d.symbol
    })),
    networkLocation: token.networkLocation
  }
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeAccountApi(ai: ApiInput, accountId: string): EdgeAccount {
  // We don't want accountState to be undefined when we log out,
  // so preserve a snapshot of our last state:
  let lastState = ai.props.state.accounts[accountId]
  const accountState = (): AccountState => {
    const nextState = ai.props.state.accounts[accountId]
    if (nextState != null) lastState = nextState
    return lastState
  }

  const { accountWalletInfo, loginType } = accountState()

  // Plugin config API's:
  const currencyConfigs: EdgePluginMap<EdgeCurrencyConfig> = {}
  for (const pluginId of Object.keys(ai.props.state.plugins.currency)) {
    const api = new CurrencyConfig(ai, accountId, pluginId)
    currencyConfigs[pluginId] = api
  }
  const swapConfigs: EdgePluginMap<EdgeSwapConfig> = {}
  for (const pluginId of Object.keys(ai.props.state.plugins.swap)) {
    const api = new SwapConfig(ai, accountId, pluginId)
    swapConfigs[pluginId] = api
  }

  // Specialty API's:
  const dataStore = makeDataStoreApi(ai, accountId)
  const storageWalletApi = makeStorageWalletApi(ai, accountWalletInfo)

  function lockdown(): void {
    if (ai.props.state.hideKeys) {
      throw new Error('Not available when `hideKeys` is enabled')
    }
  }

  // This is used to fake duress mode settings while in duress mode:
  let fakeDuressModeSetup = false

  const out: EdgeAccount = {
    on: onMethod,
    watch: watchMethod,

    // ----------------------------------------------------------------
    // Data store:
    // ----------------------------------------------------------------

    get id(): string {
      return storageWalletApi.id
    },

    get type(): string {
      return storageWalletApi.type
    },

    get disklet(): Disklet {
      lockdown()
      return storageWalletApi.disklet
    },

    get localDisklet(): Disklet {
      lockdown()
      return storageWalletApi.localDisklet
    },

    async sync(): Promise<void> {
      await storageWalletApi.sync()
    },

    // ----------------------------------------------------------------
    // Basic login information:
    // ----------------------------------------------------------------

    get appId(): string {
      return accountState().login.appId
    },

    get created(): Date | undefined {
      return accountState().login.created
    },

    async getLoginKey(): Promise<string> {
      lockdown()
      return base58.stringify(accountState().login.loginKey)
    },

    get lastLogin(): Date {
      return accountState().login.lastLogin
    },

    get loggedIn(): boolean {
      return ai.props.state.accounts[accountId] != null
    },

    get recoveryKey(): string | undefined {
      lockdown()
      const { login } = accountState()
      return login.recovery2Key != null
        ? base58.stringify(login.recovery2Key)
        : undefined
    },

    get rootLoginId(): string {
      lockdown()
      const { loginTree } = accountState()
      return base58.stringify(loginTree.loginId)
    },

    get username(): string | undefined {
      const { loginTree } = accountState()
      return loginTree.username
    },

    // ----------------------------------------------------------------
    // Duress mode:
    // ----------------------------------------------------------------

    get canDuressLogin(): boolean {
      const { activeAppId } = accountState()
      if (ai.props.state.clientInfo.duressEnabled) {
        return fakeDuressModeSetup
      }
      const duressAppId = activeAppId.endsWith('.duress')
        ? activeAppId
        : activeAppId + '.duress'
      const duressStash = searchTree(
        accountState().loginTree,
        stash => stash.appId === duressAppId
      )
      return duressStash?.pin2Key != null
    },

    get isDuressAccount(): boolean {
      const { activeAppId } = accountState()
      return activeAppId.endsWith('.duress')
    },

    // ----------------------------------------------------------------
    // Specialty API's:
    // ----------------------------------------------------------------

    get currencyConfig(): EdgePluginMap<EdgeCurrencyConfig> {
      return currencyConfigs
    },

    get swapConfig(): EdgePluginMap<EdgeSwapConfig> {
      return swapConfigs
    },

    get dataStore(): EdgeDataStore {
      return dataStore
    },

    // ----------------------------------------------------------------
    // What login method was used?
    // ----------------------------------------------------------------

    get edgeLogin(): boolean {
      const { loginTree } = accountState()
      return loginTree.loginKey == null
    },

    keyLogin: loginType === 'keyLogin',
    newAccount: loginType === 'newAccount',
    passwordLogin: loginType === 'passwordLogin',
    pinLogin: loginType === 'pinLogin',
    recoveryLogin: loginType === 'recoveryLogin',

    // ----------------------------------------------------------------
    // Change or create credentials:
    // ----------------------------------------------------------------

    async changePassword(password: string): Promise<void> {
      lockdown()
      // Noop for duress accounts:
      if (this.isDuressAccount) return
      await changePassword(ai, accountId, password)
    },

    async changePin(opts: ChangePinOptions): Promise<string> {
      lockdown()
      // For crash errors:
      ai.props.log.breadcrumb('EdgeAccount.changePin', {})
      // Check if we are in duress mode:
      const { forDuressAccount = false } = opts
      const { activeAppId } = accountState()
      const duressAppId = activeAppId.endsWith('.duress')
        ? activeAppId
        : activeAppId + '.duress'
      // Fakes for duress mode:
      if (this.isDuressAccount) {
        // Fake duress mode setup if this is a duress account:
        if (forDuressAccount) {
          fakeDuressModeSetup = opts.enableLogin ?? opts.pin != null
          ai.props.dispatch({ type: 'UPDATE_NEXT' })
          return ''
        }
      }
      // Ensure the duress account exists:
      if (forDuressAccount) {
        await ensureAccountExists(
          ai,
          accountState().stashTree,
          accountState().sessionKey,
          duressAppId
        )
      }
      await changePin(ai, accountId, opts)
      const login = forDuressAccount
        ? searchTree(accountState().login, stash => stash.appId === duressAppId)
        : accountState().login
      if (login == null) {
        // This shouldn't ever happen because not finding the duress account
        // when we have called `ensureAccountExists` is a bug in
        // `ensureAccountExists`.
        throw new Error('Failed to find account.')
      }
      return login.pin2Key != null ? base58.stringify(login.pin2Key) : ''
    },

    async changeRecovery(
      questions: string[],
      answers: string[]
    ): Promise<string> {
      lockdown()
      if (this.isDuressAccount) {
        // Use something that looks like a valid recovery key,
        // but is not the real one. So that way if support ever encounters it,
        // they know the person had attempted to get access to an account that
        // was in duress mode, or a user accidentally was in duress mode when
        // setting up password recovery (unlikely, but possible).
        // This is one of satoshi's non-spendable addresses on-chain:
        // https://www.blockchain.com/explorer/addresses/btc/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
        return '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      }
      await changeRecovery(ai, accountId, questions, answers)
      const { loginTree } = accountState()
      if (loginTree.recovery2Key == null) {
        throw new Error('Missing recoveryKey')
      }
      return base58.stringify(loginTree.recovery2Key)
    },

    async changeUsername(change: ChangeUsernameOptions): Promise<void> {
      lockdown()
      change.username = fixUsername(change.username)
      await changeUsername(ai, accountId, change)
    },

    // ----------------------------------------------------------------
    // Verify existing credentials:
    // ----------------------------------------------------------------

    async checkPassword(password: string): Promise<boolean> {
      lockdown()
      const { loginTree, stashTree } = accountState()
      // The loginKey is a deprecated optimization because LoginTree is
      // deprecated:
      const { loginKey } = loginTree
      return await checkPassword(ai, stashTree, password, loginKey)
    },

    async checkPin(
      pin: string,
      opts: { forDuressAccount?: boolean } = {}
    ): Promise<boolean> {
      lockdown()
      const { login, loginTree } = accountState()

      // Try to check the PIN locally, then fall back on the server:
      if (login.pin != null && opts.forDuressAccount == null) {
        return pin === login.pin
      } else {
        return await checkPin2(ai, loginTree, pin, opts.forDuressAccount)
      }
    },

    async getPin(): Promise<string | undefined> {
      const { login, loginTree } = accountState()
      return login.pin ?? loginTree.pin
    },

    // ----------------------------------------------------------------
    // Remove credentials:
    // ----------------------------------------------------------------

    async deletePassword(): Promise<void> {
      lockdown()
      await deletePassword(ai, accountId)
    },

    async deletePin(): Promise<void> {
      lockdown()
      // Check if we are in duress mode:
      const inDuressMode = ai.props.state.clientInfo.duressEnabled
      await deletePin(ai, accountId, inDuressMode)
    },

    async deleteRecovery(): Promise<void> {
      lockdown()
      await deleteRecovery(ai, accountId)
    },

    // ----------------------------------------------------------------
    // OTP:
    // ----------------------------------------------------------------

    get otpKey(): string | undefined {
      lockdown()
      const { loginTree } = accountState()
      return loginTree.otpKey != null
        ? base32.stringify(loginTree.otpKey, { pad: false })
        : undefined
    },

    get otpResetDate(): Date | undefined {
      lockdown()
      const { loginTree } = accountState()
      return loginTree.otpResetDate
    },

    async cancelOtpReset(): Promise<void> {
      lockdown()
      await cancelOtpReset(ai, accountId)
    },

    async enableOtp(timeout: number = 7 * 24 * 60 * 60): Promise<void> {
      lockdown()
      if (this.isDuressAccount) {
        return await enableTempOtp(ai, accountId)
      }
      await enableOtp(ai, accountId, timeout)
    },

    async disableOtp(): Promise<void> {
      lockdown()
      if (this.isDuressAccount) {
        return await disableTempOtp(ai, accountId)
      }
      await disableOtp(ai, accountId)
    },

    async repairOtp(otpKey: string): Promise<void> {
      lockdown()
      await repairOtp(ai, accountId, base32.parse(otpKey, { loose: true }))
    },

    // ----------------------------------------------------------------
    // 2fa bypass voucher approval / rejection:
    // ----------------------------------------------------------------

    get pendingVouchers(): EdgePendingVoucher[] {
      const { login } = accountState()
      return login.pendingVouchers
    },

    async approveVoucher(voucherId: string): Promise<void> {
      const { loginTree } = accountState()
      return await changeVoucherStatus(ai, loginTree, {
        approvedVouchers: [voucherId]
      })
    },

    async rejectVoucher(voucherId: string): Promise<void> {
      const { loginTree } = accountState()
      return await changeVoucherStatus(ai, loginTree, {
        rejectedVouchers: [voucherId]
      })
    },

    // ----------------------------------------------------------------
    // Edge login approval:
    // ----------------------------------------------------------------

    async fetchLobby(lobbyId: string): Promise<EdgeLobby> {
      // For crash errors:
      ai.props.log.breadcrumb('EdgeAccount.fetchLobby', {})

      lockdown()
      return await makeLobbyApi(ai, accountId, lobbyId)
    },

    // ----------------------------------------------------------------
    // Login management:
    // ----------------------------------------------------------------

    async deleteRemoteAccount(): Promise<void> {
      const { loginTree } = accountState()
      if (this.isDuressAccount) {
        return
      }
      await deleteLogin(ai, loginTree)
    },

    async logout(): Promise<void> {
      ai.props.dispatch({ type: 'LOGOUT', payload: { accountId } })
    },

    // ----------------------------------------------------------------
    // Master wallet list:
    // ----------------------------------------------------------------

    get allKeys(): EdgeWalletInfoFull[] {
      return ai.props.state.accounts[accountId].allWalletInfosClean
    },

    async changeWalletStates(walletStates: EdgeWalletStates): Promise<void> {
      await changeWalletStates(ai, accountId, walletStates)
    },

    async createWallet(walletType: string, keys?: object): Promise<string> {
      const { login, sessionKey, stashTree } = accountState()

      // For crash errors:
      ai.props.log.breadcrumb('EdgeAccount.createWallet', {})

      const walletInfo = await makeCurrencyWalletKeys(ai, walletType, { keys })
      const childKey = decryptChildKey(stashTree, sessionKey, login.loginId)
      await applyKit(ai, sessionKey, makeKeysKit(ai, childKey, [walletInfo]))
      return walletInfo.id
    },

    getFirstWalletInfo: AccountSync.prototype.getFirstWalletInfo,
    getWalletInfo: AccountSync.prototype.getWalletInfo,
    listWalletIds: AccountSync.prototype.listWalletIds,

    async splitWalletInfo(
      walletId: string,
      newWalletType: string
    ): Promise<string> {
      return await splitWalletInfo(ai, accountId, walletId, newWalletType)
    },

    async listSplittableWalletTypes(walletId: string): Promise<string[]> {
      return await listSplittableWalletTypes(ai, accountId, walletId)
    },

    // ----------------------------------------------------------------
    // Key access:
    // ----------------------------------------------------------------

    async getDisplayPrivateKey(walletId: string): Promise<string> {
      const info = getRawPrivateKey(ai, accountId, walletId)
      const pluginId = findCurrencyPluginId(
        ai.props.state.plugins.currency,
        info.type
      )
      const tools = await getCurrencyTools(ai, pluginId)
      if (tools.getDisplayPrivateKey != null) {
        return await tools.getDisplayPrivateKey(info)
      }

      const { engine } = ai.props.output.currency.wallets[walletId]
      if (engine == null || engine.getDisplayPrivateSeed == null) {
        throw new Error('Wallet has not yet loaded')
      }
      const out = await engine.getDisplayPrivateSeed(info.keys)
      if (out == null) throw new Error('The engine failed to return a key')
      return out
    },

    async getDisplayPublicKey(walletId: string): Promise<string> {
      const info = getRawPrivateKey(ai, accountId, walletId)
      const pluginId = findCurrencyPluginId(
        ai.props.state.plugins.currency,
        info.type
      )
      const tools = await getCurrencyTools(ai, pluginId)
      if (tools.getDisplayPublicKey != null) {
        const disklet = makeLocalDisklet(ai.props.io, walletId)
        const publicInfo = await getPublicWalletInfo(info, disklet, tools)
        return await tools.getDisplayPublicKey(publicInfo)
      }

      const { engine } = ai.props.output.currency.wallets[walletId]
      if (engine == null || engine.getDisplayPublicSeed == null) {
        throw new Error('Wallet has not yet loaded')
      }
      const out = await engine.getDisplayPublicSeed()
      if (out == null) throw new Error('The engine failed to return a key')
      return out
    },

    async getRawPrivateKey(walletId: string): Promise<object> {
      return getRawPrivateKey(ai, accountId, walletId).keys
    },

    async getRawPublicKey(walletId: string): Promise<object> {
      const info = getRawPrivateKey(ai, accountId, walletId)
      const pluginId = findCurrencyPluginId(
        ai.props.state.plugins.currency,
        info.type
      )
      const tools = await getCurrencyTools(ai, pluginId)
      const disklet = makeLocalDisklet(ai.props.io, walletId)
      const publicInfo = await getPublicWalletInfo(info, disklet, tools)

      return publicInfo.keys
    },

    // ----------------------------------------------------------------
    // Currency wallets:
    // ----------------------------------------------------------------

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

    get currencyWalletErrors(): { [walletId: string]: Error } {
      return ai.props.state.accounts[accountId].currencyWalletErrors
    },

    async createCurrencyWallet(
      walletType: string,
      opts: EdgeCreateCurrencyWalletOptions = {}
    ): Promise<EdgeCurrencyWallet> {
      const { login, sessionKey, stashTree } = accountState()

      // For crash errors:
      ai.props.log.breadcrumb('EdgeAccount.createCurrencyWallet', {})

      const walletInfo = await makeCurrencyWalletKeys(ai, walletType, opts)
      const childKey = decryptChildKey(stashTree, sessionKey, login.loginId)
      await applyKit(ai, sessionKey, makeKeysKit(ai, childKey, [walletInfo]))
      return await finishWalletCreation(ai, accountId, walletInfo.id, opts)
    },

    async makeMemoryWallet(
      walletType: string,
      opts: EdgeCreateCurrencyWalletOptions = {}
    ): Promise<EdgeMemoryWallet> {
      const config = Object.values(currencyConfigs).find(
        plugin => plugin.currencyInfo.walletType === walletType
      )
      if (config == null) throw new Error('Invalid walletType')

      return await makeMemoryWalletInner(ai, config, walletType, opts)
    },

    async createCurrencyWallets(
      createWallets: EdgeCreateCurrencyWallet[]
    ): Promise<Array<EdgeResult<EdgeCurrencyWallet>>> {
      const { login, sessionKey, stashTree } = accountState()

      // For crash errors:
      ai.props.log.breadcrumb('EdgeAccount.makeMemoryWallet', {})

      // Create the keys:
      const walletInfos = await Promise.all(
        createWallets.map(
          async opts => await makeCurrencyWalletKeys(ai, opts.walletType, opts)
        )
      )

      // Store the keys on the server:
      const childKey = decryptChildKey(stashTree, sessionKey, login.loginId)
      await applyKit(ai, sessionKey, makeKeysKit(ai, childKey, walletInfos))

      // Set up options:
      return await Promise.all(
        walletInfos.map(
          async (info, i) =>
            await makeEdgeResult(
              finishWalletCreation(ai, accountId, info.id, createWallets[i])
            )
        )
      )
    },

    async waitForCurrencyWallet(walletId: string): Promise<EdgeCurrencyWallet> {
      return await new Promise((resolve, reject) => {
        const check = (): void => {
          const wallet = this.currencyWallets[walletId]
          if (wallet != null) {
            resolve(wallet)
            cleanup()
          }
          const error = this.currencyWalletErrors[walletId]
          if (error != null) {
            reject(error)
            cleanup()
          }
        }

        const cleanup = (): void => {
          for (const cleanup of cleanups) cleanup()
        }

        const cleanups = [
          this.watch('currencyWallets', check),
          this.watch('currencyWalletErrors', check)
        ]

        check()
      })
    },

    async waitForAllWallets(): Promise<void> {
      return await new Promise((resolve, reject) => {
        const check = (): void => {
          const busyWallet = this.activeWalletIds.find(
            id =>
              this.currencyWallets[id] == null &&
              this.currencyWalletErrors[id] == null
          )
          if (busyWallet == null) {
            for (const cleanup of cleanups) cleanup()
            resolve()
          }
        }

        const cleanups = [
          this.watch('activeWalletIds', check),
          this.watch('currencyWallets', check),
          this.watch('currencyWalletErrors', check)
        ]

        check()
      })
    },

    async saveWalletCache(): Promise<string> {
      // Build token map from all currency configs:
      const tokens: WalletCacheFile['tokens'] = {}
      for (const [pluginId, config] of Object.entries(currencyConfigs)) {
        const pluginTokens: { [tokenId: string]: CachedToken } = {}
        for (const [tokenId, token] of Object.entries(config.allTokens)) {
          pluginTokens[tokenId] = edgeTokenToCachedToken(token)
        }
        if (Object.keys(pluginTokens).length > 0) {
          tokens[pluginId] = pluginTokens
        }
      }

      // Build wallet array from active wallets:
      const wallets: CachedWallet[] = []
      for (const walletId of this.activeWalletIds) {
        const wallet = this.currencyWallets[walletId]
        if (wallet == null) continue

        // Convert balanceMap to balances object:
        const balances: { [tokenId: string]: string } = {}
        for (const [tokenId, balance] of wallet.balanceMap) {
          // Use "null" string for parent currency (null tokenId)
          const key = tokenId ?? 'null'
          balances[key] = balance
        }

        // Get custom tokens:
        const customTokens: { [tokenId: string]: CachedToken } = {}
        const config = wallet.currencyConfig
        for (const [tokenId, token] of Object.entries(config.customTokens)) {
          customTokens[tokenId] = edgeTokenToCachedToken(token)
        }

        // Get change service subscriptions from Redux state:
        const walletState = ai.props.state.currency.wallets[walletId]
        const subscribedAddresses =
          walletState?.changeServiceSubscriptions
            ?.filter(sub => sub.status !== 'avoiding')
            .map(sub => ({
              address: sub.address,
              checkpoint: sub.checkpoint
            })) ?? []

        wallets.push({
          id: wallet.id,
          type: wallet.type,
          name: wallet.name ?? undefined,
          pluginId: wallet.currencyInfo.pluginId,
          fiatCurrencyCode: wallet.fiatCurrencyCode,
          balances,
          enabledTokenIds: wallet.enabledTokenIds,
          customTokens,
          subscribedAddresses:
            subscribedAddresses.length > 0 ? subscribedAddresses : undefined,
          seenTxCheckpoint: walletState?.seenTxCheckpoint ?? undefined
        })
      }

      // Build the cache file:
      const cacheFile: WalletCacheFile = {
        version: 1,
        tokens,
        wallets
      }

      // Save to accountCache/[accountId]/walletCache.json:
      const cachePath = `accountCache/${storageWalletApi.id}/walletCache.json`
      const cacheJson = JSON.stringify(cacheFile, null, 2)
      await ai.props.io.disklet.setText(cachePath, cacheJson)

      return cachePath
    },

    // ----------------------------------------------------------------
    // Token & wallet activation:
    // ----------------------------------------------------------------

    async getActivationAssets({
      activateWalletId,
      activateTokenIds
    }: EdgeGetActivationAssetsOptions): Promise<EdgeGetActivationAssetsResults> {
      const { currencyWallets } = ai.props.output.accounts[accountId]
      const walletOutput = ai.props.output.currency.wallets[activateWalletId]
      const { engine } = walletOutput

      if (engine == null)
        throw new Error(`Invalid wallet: ${activateWalletId} not found`)

      if (engine.engineGetActivationAssets == null)
        throw new Error(
          `getActivationAssets unsupported by walletId ${activateWalletId}`
        )

      const out = await engine.engineGetActivationAssets({
        currencyWallets,
        activateTokenIds
      })

      // Added for backward compatibility for plugins using core 1.x
      out.assetOptions.forEach(asset => (asset.tokenId = asset.tokenId ?? null))
      return out
    },

    async activateWallet(
      opts: EdgeActivationOptions
    ): Promise<EdgeActivationQuote> {
      const { activateWalletId, activateTokenIds, paymentInfo } = opts
      const { currencyWallets } = ai.props.output.accounts[accountId]
      const walletOutput = ai.props.output.currency.wallets[activateWalletId]
      const { engine } = walletOutput

      if (engine == null)
        throw new Error(`Invalid wallet: ${activateWalletId} not found`)

      if (engine.engineActivateWallet == null)
        throw new Error(
          `activateWallet unsupported by walletId ${activateWalletId}`
        )
      const walletId = paymentInfo?.walletId ?? ''
      const wallet = currencyWallets[walletId]

      if (wallet == null) {
        throw new Error(`No wallet for walletId ${walletId}`)
      }

      const out = await engine.engineActivateWallet({
        activateTokenIds,
        paymentInfo:
          paymentInfo != null
            ? {
                wallet,
                tokenId: paymentInfo.tokenId
              }
            : undefined,

        // Added for backward compatibility for plugins using core 1.x
        // @ts-expect-error
        paymentTokenId: paymentInfo?.tokenId,
        paymentWallet: wallet
      })

      // Added for backward compatibility for plugins using core 1.x
      if (out.networkFee.tokenId === undefined) out.networkFee.tokenId = null

      return bridgifyObject(out)
    },

    // ----------------------------------------------------------------
    // Swapping:
    // ----------------------------------------------------------------

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      opts?: EdgeSwapRequestOptions
    ): Promise<EdgeSwapQuote> {
      const [bestQuote, ...otherQuotes] = await fetchSwapQuotes(
        ai,
        accountId,
        request,
        opts
      )

      // Close unused quotes:
      for (const otherQuote of otherQuotes) {
        otherQuote.close().catch(() => undefined)
      }

      // Return the front quote:
      if (bestQuote == null) throw new Error('No swap providers enabled')
      return bestQuote
    },

    async fetchSwapQuotes(
      request: EdgeSwapRequest,
      opts?: EdgeSwapRequestOptions
    ): Promise<EdgeSwapQuote[]> {
      return await fetchSwapQuotes(ai, accountId, request, opts)
    }
  }
  bridgifyObject(out)

  return out
}

function getRawPrivateKey(
  ai: ApiInput,
  accountId: string,
  walletId: string
): EdgeWalletInfoFull {
  const infos = ai.props.state.accounts[accountId].allWalletInfosFull
  const info = infos.find(key => key.id === walletId)
  if (info == null) {
    throw new Error(`Invalid wallet: ${walletId} not found`)
  }
  return info
}

async function makeEdgeResult<T>(promise: Promise<T>): Promise<EdgeResult<T>> {
  try {
    return { ok: true, result: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Creates an EdgeAccount with cached wallets for testing performance.
 * All wallet operations are stubbed and logged.
 */
export function makeAccountApiWithCachedWallets(
  ai: ApiInput,
  accountId: string,
  cacheSetup: WalletCacheSetup
): EdgeAccount {
  // Create the base account API first:
  const baseApi = makeAccountApi(ai, accountId)

  // Copy the base API using Object.defineProperties to avoid evaluating getters.
  // Direct spreading {...baseApi} would evaluate getters like disklet/localDisklet
  // which access state.storageWallets that isn't initialized during cache loading.
  const baseDescriptors = Object.getOwnPropertyDescriptors(baseApi)

  // Override properties for cache mode
  // Note: disklet and localDisklet are NOT overridden - they use the real
  // storage wallet disklets since we initialize the storage wallet before
  // creating this cached API (storage wallets don't need engines)
  const overrideDescriptors: PropertyDescriptorMap = {

    // Override currency config to use cached configs:
    currencyConfig: {
      get() {
        return cacheSetup.currencyConfigs
      },
      configurable: true,
      enumerable: true
    },

    // Override currency wallets to use cached wallets:
    currencyWallets: {
      get() {
        return cacheSetup.currencyWallets
      },
      configurable: true,
      enumerable: true
    },

    // Override active wallet IDs:
    activeWalletIds: {
      get() {
        return cacheSetup.activeWalletIds
      },
      configurable: true,
      enumerable: true
    },

    // Cached wallets have no archived wallets:
    archivedWalletIds: {
      get() {
        return []
      },
      configurable: true,
      enumerable: true
    },

    // Cached wallets have no hidden wallets:
    hiddenWalletIds: {
      get() {
        return []
      },
      configurable: true,
      enumerable: true
    },

    // Cached wallets have no errors:
    currencyWalletErrors: {
      get() {
        return {}
      },
      configurable: true,
      enumerable: true
    },

    // Stub wallet creation methods:
    createCurrencyWallet: {
      value: async (): Promise<EdgeCurrencyWallet> => {
        console.log(
          '[WalletCache] createCurrencyWallet() - not supported in cache mode'
        )
        throw new Error('Cannot create wallets in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    createCurrencyWallets: {
      value: async (): Promise<Array<EdgeResult<EdgeCurrencyWallet>>> => {
        console.log(
          '[WalletCache] createCurrencyWallets() - not supported in cache mode'
        )
        throw new Error('Cannot create wallets in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    makeMemoryWallet: {
      value: async (): Promise<EdgeMemoryWallet> => {
        console.log(
          '[WalletCache] makeMemoryWallet() - not supported in cache mode'
        )
        throw new Error('Cannot create memory wallets in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    getActivationAssets: {
      value: async (): Promise<EdgeGetActivationAssetsResults> => {
        console.log(
          '[WalletCache] getActivationAssets() - not supported in cache mode'
        )
        throw new Error('Cannot get activation assets in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    activateWallet: {
      value: async (): Promise<EdgeActivationQuote> => {
        console.log(
          '[WalletCache] activateWallet() - not supported in cache mode'
        )
        throw new Error('Cannot activate wallets in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    // Stub wallet state changes:
    changeWalletStates: {
      value: async (): Promise<void> => {
        console.log(
          '[WalletCache] changeWalletStates() - ignored in cache mode'
        )
      },
      configurable: true,
      enumerable: true
    },

    // Stub wallet cache (already in cache mode):
    saveWalletCache: {
      value: async (): Promise<string> => {
        console.log('[WalletCache] saveWalletCache() - no-op in cache mode')
        return ''
      },
      configurable: true,
      enumerable: true
    },

    // Swap operations are stubbed:
    fetchSwapQuote: {
      value: async (): Promise<EdgeSwapQuote> => {
        console.log(
          '[WalletCache] fetchSwapQuote() - not supported in cache mode'
        )
        throw new Error('Cannot fetch swap quotes in cache mode')
      },
      configurable: true,
      enumerable: true
    },

    fetchSwapQuotes: {
      value: async (): Promise<EdgeSwapQuote[]> => {
        console.log(
          '[WalletCache] fetchSwapQuotes() - not supported in cache mode'
        )
        throw new Error('Cannot fetch swap quotes in cache mode')
      },
      configurable: true,
      enumerable: true
    }
  }

  // Combine base descriptors with overrides (overrides take precedence)
  const out = Object.defineProperties(
    {},
    { ...baseDescriptors, ...overrideDescriptors }
  ) as EdgeAccount

  bridgifyObject(out)
  return out
}

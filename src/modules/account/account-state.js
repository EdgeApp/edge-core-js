// @flow

import { base32 } from 'rfc4648'

import type {
  EdgeAccountCallbacks,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyPlugin,
  EdgeCurrencyToolsMap,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../edge-core-index.js'
import { fixOtpKey } from '../../util/crypto/hotp.js'
import { createReaction } from '../../util/redux/reaction.js'
import {
  getCurrencyPlugin,
  waitForCurrencyPlugins,
  waitForCurrencyWallet
} from '../currency/currency-selectors.js'
import { makeCreateKit } from '../login/create.js'
import type { LoginCreateOpts } from '../login/create.js'
import {
  findFirstKey,
  fixWalletInfo,
  getAllWalletInfos,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo,
  splitWalletInfo
} from '../login/keys.js'
import type { LoginKit, LoginTree } from '../login/login-types.js'
import { applyKit, searchTree, syncLogin } from '../login/login.js'
import { makePasswordKit } from '../login/password.js'
import { makeChangePin2Kits, makeDeletePin2Kits } from '../login/pin2.js'
import { makeRecovery2Kit } from '../login/recovery2.js'
import type { ApiInput } from '../root.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../storage/storage-actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastChanges
} from '../storage/storage-selectors.js'
import { CurrencyTools, reloadPluginSettings } from './currency-api.js'
import { changeWalletStates, loadAllWalletStates } from './wallet-states.js'

const CURRENCY_SETTINGS_FILE = 'CurrencySettings.json'

export function findAppLogin (loginTree: LoginTree, appId: string): LoginTree {
  const out = searchTree(loginTree, login => login.appId === appId)
  if (!out) throw new Error(`Internal error: cannot find login for ${appId}`)
  return out
}

function checkLogin (login) {
  if (login == null || login.loginKey == null) {
    throw new Error('Incomplete login')
  }
}

/**
 * Creates a child login under the provided login, with the given appId.
 */
function createChildLogin (ai, loginTree, login, appId, wantRepo = true) {
  const { username } = loginTree
  checkLogin(login)
  if (!username) throw new Error('Cannot create child: missing username')

  const opts: LoginCreateOpts = { pin: loginTree.pin }
  if (wantRepo) {
    opts.keyInfo = makeStorageKeyInfo(ai, makeAccountType(appId))
  }
  return makeCreateKit(ai, login, appId, username, opts).then(kit => {
    const parentKit = {
      serverPath: kit.serverPath,
      server: kit.server || {},
      login: { children: [kit.login] },
      stash: { children: [kit.stash] },
      loginId: login.loginId
    }
    return applyKit(ai, loginTree, parentKit)
  })
}

/**
 * Ensures that the loginTree contains an account for the specified appId.
 * @return A `Promise`, which will resolve to a loginTree that does have
 * the requested account.
 */
export function ensureAccountExists (
  ai: ApiInput,
  loginTree: LoginTree,
  appId: string
): Promise<LoginTree> {
  const accountType = makeAccountType(appId)

  // If there is no app login, make that:
  const login = searchTree(loginTree, login => login.appId === appId)
  if (login == null) {
    return createChildLogin(ai, loginTree, loginTree, appId, true)
  }

  // Otherwise, make the repo:
  if (findFirstKey(login.keyInfos, accountType) == null) {
    checkLogin(login)
    const keyInfo = makeStorageKeyInfo(ai, accountType)
    const keysKit = makeKeysKit(ai, login, keyInfo)
    return applyKit(ai, loginTree, keysKit)
  }

  // Everything is fine, so do nothing:
  return Promise.resolve(loginTree)
}

/**
 * This is the data an account contains, and the methods to update it.
 */
export class AccountState {
  ai: ApiInput
  appId: string
  accountWalletInfo: EdgeWalletInfo
  callbacks: Object
  currencyTools: EdgeCurrencyToolsMap
  loginTree: LoginTree
  login: LoginTree
  legacyWalletInfos: Array<EdgeWalletInfo>
  walletStates: EdgeWalletStates
  activeLoginId: string
  disposer: any

  constructor (
    ai: ApiInput,
    appId: string,
    loginTree: LoginTree,
    accountWalletInfo: EdgeWalletInfo,
    currencyPlugins: Array<EdgeCurrencyPlugin>,
    callbacks: EdgeAccountCallbacks
  ) {
    if (!loginTree.username) throw new Error('Cannot log in: missing username')
    const { username } = loginTree

    // Constant stuff:
    this.ai = ai
    this.appId = appId
    this.accountWalletInfo = accountWalletInfo
    this.callbacks = callbacks

    // Login state:
    this.loginTree = loginTree
    this.login = findAppLogin(loginTree, this.appId)
    this.legacyWalletInfos = []
    this.walletStates = {}

    // Add the login to redux:
    const { dispatch } = ai.props
    dispatch({
      type: 'LOGIN',
      payload: {
        appId,
        callbacks,
        username,
        loginKey: this.login.loginKey
      }
    })
    this.activeLoginId = ai.props.state.login.lastActiveLoginId

    this.currencyTools = {}
    const currencySettingsFile = getStorageWalletFolder(
      ai.props.state,
      accountWalletInfo.id
    ).file(CURRENCY_SETTINGS_FILE)
    for (const plugin of currencyPlugins) {
      this.currencyTools[plugin.pluginName] = new CurrencyTools(
        ai,
        plugin,
        currencySettingsFile
      )
    }

    // While it would make logical sense to do this now,
    // starting the wallet engines is too expensive,
    // so we allow the data sync to trigger the work later:
    // const { activeLoginId } = this
    // dispatch({
    //   type: 'ACCOUNT_KEYS_LOADED',
    //   payload: { activeLoginId, walletInfos: this.allKeys }
    // })

    this.startTimer()
  }

  startTimer () {
    setTimeout(() => {
      // If we are logged out, do nothing!
      if (!this.login) return

      syncStorageWallet(this.ai, this.accountWalletInfo.id)
        .then(changes => this.startTimer())
        .catch(e => this.startTimer())
    }, 30000)
  }

  async onDataChanged (changes: Array<string>) {
    // If we are logged out, do nothing!
    if (!this.login) return

    const currencySettingsFile = getStorageWalletFolder(
      this.ai.props.state,
      this.accountWalletInfo.id
    ).file(CURRENCY_SETTINGS_FILE)
    await reloadPluginSettings(this.ai, currencySettingsFile)
    await this.reloadWalletStates()
    if (this.callbacks.onKeyListChanged) {
      this.callbacks.onKeyListChanged()
    }
  }

  async logout () {
    const { activeLoginId } = this
    const { dispatch } = this.ai.props
    dispatch({ type: 'LOGOUT', payload: { activeLoginId } })

    // Shut down:
    dispatch(this.disposer)
    const killedAccount: any = this
    killedAccount.ai = null

    // Clear keys:
    killedAccount.appId = null
    killedAccount.accountWalletInfo = null
    killedAccount.loginTree = null
    killedAccount.login = null
    killedAccount.legacyWalletInfos = null
    killedAccount.walletStates = null

    if (this.callbacks.onLoggedOut) this.callbacks.onLoggedOut()
  }

  enableOtp (otpTimeout: number) {
    const { ai } = this
    const login = this.loginTree
    checkLogin(login)
    const otpKey =
      login.otpKey != null
        ? fixOtpKey(login.otpKey)
        : base32.stringify(ai.props.io.random(10))

    const kit = {
      serverPath: '/v2/login/otp',
      server: {
        otpKey,
        otpTimeout
      },
      stash: {
        otpKey,
        otpResetDate: void 0,
        otpTimeout
      },
      login: {
        otpKey,
        otpResetDate: void 0,
        otpTimeout
      },
      loginId: login.loginId
    }
    return this.applyKit(kit)
  }

  disableOtp () {
    const login = this.loginTree
    checkLogin(login)

    const kit = {
      serverMethod: 'DELETE',
      serverPath: '/v2/login/otp',
      stash: {
        otpKey: void 0,
        otpResetDate: void 0,
        otpTimeout: void 0
      },
      login: {
        otpKey: void 0,
        otpResetDate: void 0,
        otpTimeout: void 0
      },
      loginId: login.loginId
    }
    return this.applyKit(kit)
  }

  cancelOtpReset () {
    const login = this.loginTree
    checkLogin(login)

    const kit = {
      serverPath: '/v2/login/otp',
      server: {
        otpTimeout: login.otpTimeout,
        otpKey: login.otpKey
      },
      stash: {
        otpResetDate: void 0
      },
      login: {
        otpResetDate: void 0
      },
      loginId: login.loginId
    }
    return this.applyKit(kit)
  }

  changePassword (password: string) {
    const { ai, loginTree: { username } } = this
    const login = this.loginTree
    checkLogin(login)
    if (!username) throw new Error('Cannot change password: missing username')

    return makePasswordKit(ai, login, username, password).then(kit =>
      this.applyKit(kit)
    )
  }

  changePin (pin: string | void, enableLogin: boolean | void) {
    const { ai, loginTree: { username } } = this
    const login = this.loginTree
    checkLogin(login)
    if (!username) throw new Error('Cannot change pin: missing username')

    // Figure out defaults:
    if (enableLogin == null) {
      enableLogin = login.pin2Key != null || (pin != null && login.pin == null)
    }
    if (pin == null) pin = login.pin

    // We cannot enable PIN login if we don't know the PIN:
    if (pin == null) {
      if (!enableLogin) {
        // But we can disable PIN login by just deleting it entirely:
        return this.applyKits(makeDeletePin2Kits(login))
      }
      throw new Error(
        'Please change your PIN in the settings area above before enabling.'
      )
    }

    const kits = makeChangePin2Kits(ai, login, username, pin, enableLogin)
    return this.applyKits(kits)
  }

  changeRecovery (questions: Array<string>, answers: Array<string>) {
    const { ai, loginTree: { username } } = this
    const login = this.loginTree
    checkLogin(login)
    if (!username) throw new Error('Cannot change recovery: missing username')

    const kit = makeRecovery2Kit(ai, login, username, questions, answers)
    return this.applyKit(kit)
  }

  deletePassword () {
    const login = this.loginTree
    checkLogin(login)

    const kit = {
      serverMethod: 'DELETE',
      serverPath: '/v2/login/password',
      stash: {
        passwordAuthBox: void 0,
        passwordAuthSnrp: void 0,
        passwordBox: void 0,
        passwordKeySnrp: void 0
      },
      login: {
        passwordAuthBox: void 0,
        passwordAuthSnrp: void 0,
        passwordBox: void 0,
        passwordKeySnrp: void 0
      },
      loginId: login.loginId
    }
    return this.applyKit(kit)
  }

  deletePin () {
    const login = this.loginTree
    checkLogin(login)

    const kits = makeDeletePin2Kits(login)
    return this.applyKits(kits)
  }

  deleteRecovery () {
    const login = this.loginTree
    checkLogin(login)

    const kit = {
      serverMethod: 'DELETE',
      serverPath: '/v2/login/recovery2',
      stash: {
        recovery2Key: void 0
      },
      login: {
        recovery2Key: void 0
      },
      loginId: login.loginId
    }
    return this.applyKit(kit)
  }

  applyKit (kit: LoginKit) {
    return applyKit(this.ai, this.loginTree, kit).then(loginTree => {
      this.loginTree = loginTree
      this.login = findAppLogin(loginTree, this.appId)

      // Update the key list in case something changed:
      const { activeLoginId, ai } = this
      ai.props.dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: { activeLoginId, walletInfos: this.allKeys }
      })

      return this
    })
  }

  /*
   * Applies an array of kits to a login, one after another.
   * We can't use `Promise.all`, since `applyKit` doesn't handle
   * parallelism correctly.
   */
  applyKits (kits: Array<LoginKit>): Promise<mixed> {
    if (!kits.length) return Promise.resolve(this)

    const [first, ...rest] = kits
    return this.applyKit(first).then(() => this.applyKits(rest))
  }

  changeWalletStates (newStates: EdgeWalletStates) {
    const { ai, accountWalletInfo, walletStates } = this
    return changeWalletStates(
      ai.props.state,
      accountWalletInfo.id,
      walletStates,
      newStates
    ).then(walletStates => {
      this.walletStates = walletStates

      // Update the key list in case something changed:
      const { activeLoginId, ai } = this
      ai.props.dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: { activeLoginId, walletInfos: this.allKeys }
      })

      if (this.callbacks.onKeyListChanged) {
        this.callbacks.onKeyListChanged()
      }
      return void 0
    })
  }

  async reloadWalletStates () {
    const { ai, accountWalletInfo, activeLoginId } = this
    const { walletInfos, walletStates } = await loadAllWalletStates(
      ai.props.state,
      accountWalletInfo.id
    )
    this.legacyWalletInfos = walletInfos
    this.walletStates = walletStates

    const { dispatch } = ai.props
    dispatch({
      type: 'ACCOUNT_KEYS_LOADED',
      payload: { activeLoginId, walletInfos: this.allKeys }
    })

    return this
  }

  syncLogin () {
    const { ai, loginTree, login } = this
    return syncLogin(ai, loginTree, login).then(loginTree => {
      this.loginTree = loginTree
      this.login = findAppLogin(loginTree, this.appId)

      // Update the key list in case something changed:
      const { activeLoginId, ai } = this
      ai.props.dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: { activeLoginId, walletInfos: this.allKeys }
      })

      return this
    })
  }

  async createCurrencyWallet (
    type: string,
    opts: EdgeCreateCurrencyWalletOptions
  ) {
    const { ai, login } = this

    // Make the keys:
    const plugin = getCurrencyPlugin(ai.props.output.currency.plugins, type)
    const keys = opts.keys || plugin.createPrivateKey(type, opts.keyOptions)
    const walletInfo = makeStorageKeyInfo(ai, type, keys)
    const kit = makeKeysKit(ai, login, fixWalletInfo(walletInfo))

    // Add the keys to the login:
    await this.applyKit(kit)
    const wallet = await waitForCurrencyWallet(ai, walletInfo.id)

    if (opts.name) await wallet.renameWallet(opts.name)
    if (opts.fiatCurrencyCode) {
      await wallet.setFiatCurrencyCode(opts.fiatCurrencyCode)
    }

    return wallet
  }

  async splitWalletInfo (walletId: string, newWalletType: string) {
    const { ai, login } = this
    const allWalletInfos = this.allKeys

    // Find the wallet we are going to split:
    const walletInfo = allWalletInfos.find(
      walletInfo => walletInfo.id === walletId
    )
    if (!walletInfo) throw new Error(`Invalid wallet id ${walletId}`)

    // Handle BCH / BTC+segwit special case:
    if (
      newWalletType === 'wallet:bitcoincash' &&
      walletInfo.type === 'wallet:bitcoin' &&
      walletInfo.keys.format === 'bip49'
    ) {
      throw new Error(
        'Cannot split segwit-format Bitcoin wallets to Bitcoin Cash'
      )
    }

    // See if the wallet has already been split:
    const newWalletInfo = splitWalletInfo(walletInfo, newWalletType)
    const existingWalletInfo = allWalletInfos.find(
      walletInfo => walletInfo.id === newWalletInfo.id
    )
    if (existingWalletInfo) {
      if (existingWalletInfo.archived || existingWalletInfo.deleted) {
        // Simply undelete the existing wallet:
        const walletInfos = {}
        walletInfos[newWalletInfo.id] = { archived: false, deleted: false }
        await this.changeWalletStates(walletInfos)
        return walletInfo.id
      }
      throw new Error('This wallet has already been split')
    }

    // Add the keys to the login:
    const kit = makeKeysKit(ai, login, newWalletInfo)
    await this.applyKit(kit)

    // Try to copy metadata on a best-effort basis.
    // In the future we should clone the repo instead:
    try {
      const wallet = await waitForCurrencyWallet(ai, newWalletInfo.id)
      const oldWallet = ai.props.output.currency.wallets[walletId].api
      if (oldWallet) {
        if (oldWallet.name) await wallet.renameWallet(oldWallet.name)
        if (oldWallet.fiatCurrencyCode) {
          await wallet.setFiatCurrencyCode(oldWallet.fiatCurrencyCode)
        }
      }
    } catch (e) {
      ai.props.onError(e)
    }

    return newWalletInfo.id
  }

  listSplittableWalletTypes (walletId: string): Promise<Array<string>> {
    const allWalletInfos = this.allKeys

    // Find the wallet we are going to split:
    const walletInfo = allWalletInfos.find(
      walletInfo => walletInfo.id === walletId
    )
    if (!walletInfo) throw new Error(`Invalid wallet id ${walletId}`)

    // Get the list of available types:
    const plugin = getCurrencyPlugin(
      this.ai.props.output.currency.plugins,
      walletInfo.type
    )
    const types =
      plugin && plugin.getSplittableTypes
        ? plugin.getSplittableTypes(walletInfo)
        : []

    // Filter out wallet types we have already split:
    return Promise.resolve(
      types.filter(type => {
        const newWalletInfo = splitWalletInfo(walletInfo, type)
        const existingWalletInfo = allWalletInfos.find(
          walletInfo => walletInfo.id === newWalletInfo.id
        )
        // We can split the wallet if it doesn't exist, or is deleted:
        return (
          !existingWalletInfo ||
          existingWalletInfo.archived ||
          existingWalletInfo.deleted
        )
      })
    )
  }

  get allKeys (): Array<EdgeWalletInfoFull> {
    const { walletStates, legacyWalletInfos, login } = this
    const values = getAllWalletInfos(login, legacyWalletInfos)
    const { walletInfos, appIdMap } = values
    const getLast = array => array[array.length - 1]

    return walletInfos.map(info => ({
      appId: getLast(appIdMap[info.id]),
      appIds: appIdMap[info.id],
      archived: false,
      deleted: false,
      sortIndex: walletInfos.length,
      ...walletStates[info.id],
      ...info
    }))
  }
}

export async function makeAccountState (
  ai: ApiInput,
  appId: string,
  loginTree: LoginTree,
  callbacks: Object
): Promise<AccountState> {
  const currencyPlugins = await waitForCurrencyPlugins(ai)

  return ensureAccountExists(ai, loginTree, appId).then(loginTree => {
    // Find our repo:
    const type = makeAccountType(appId)
    const login = findAppLogin(loginTree, appId)
    const accountWalletInfo = findFirstKey(login.keyInfos, type)
    if (accountWalletInfo == null) {
      throw new Error(`Cannot find a "${type}" repo`)
    }

    return addStorageWallet(ai, accountWalletInfo).then(() => {
      const account = new AccountState(
        ai,
        appId,
        loginTree,
        accountWalletInfo,
        currencyPlugins,
        callbacks
      )
      const disposer = ai.props.dispatch(
        createReaction(
          state => getStorageWalletLastChanges(state, accountWalletInfo.id),
          changes => account.onDataChanged(changes)
        )
      )
      account.disposer = disposer
      const hookupResult: any = disposer.payload
      return hookupResult.out.then(() => account)
    })
  })
}

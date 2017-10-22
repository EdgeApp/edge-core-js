import { timeout } from '../../util/promise.js'
import { createReaction } from '../../util/redux/reaction.js'
import { softCat } from '../../util/util.js'
import * as ACTIONS from '../actions.js'
import {
  getCurrencyPlugin,
  waitForCurrencyPlugins
} from '../currency/currency-selectors.js'
import { makeCurrencyWalletApi } from '../currencyWallets/api.js'
import { makeCreateKit } from '../login/create.js'
import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo,
  mergeKeyInfos
} from '../login/keys.js'
import { applyKit, searchTree } from '../login/login.js'
import { makePasswordKit } from '../login/password.js'
import { makePin2Kit } from '../login/pin2.js'
import { makeRecovery2Kit } from '../login/recovery2.js'
import { getStorageWalletLastSync } from '../selectors.js'
import { changeKeyStates, loadAllKeyStates } from './keyState.js'

export function findAppLogin (loginTree, appId) {
  return searchTree(loginTree, login => login.appId === appId)
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
  const username = loginTree.username
  checkLogin(login)

  const opts = { pin: loginTree.pin }
  if (wantRepo) {
    opts.keyInfo = makeStorageKeyInfo(ai, makeAccountType(appId))
  }
  return makeCreateKit(ai, login, appId, username, opts).then(kit => {
    const parentKit = {
      serverPath: kit.serverPath,
      server: kit.server,
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
export function ensureAccountExists (ai, loginTree, appId) {
  const accountType = makeAccountType(appId)

  // If there is no app login, make that:
  const login = findAppLogin(loginTree, appId)
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
 * Binds a collection of wallet callbacks,
 * to pass into the currency wallet constructor.
 */
function makeCurrencyWalletCallbacks (walletId, accountCallbacks) {
  const {
    onAddressesChecked,
    onBalanceChanged,
    onBlockHeightChanged,
    onNewTransactions,
    onTransactionsChanged,
    onWalletDataChanged,
    onWalletNameChanged
  } = accountCallbacks

  const out = {}

  if (onAddressesChecked) {
    out.onAddressesChecked = (...rest) => onAddressesChecked(walletId, ...rest)
  }
  if (onBalanceChanged) {
    out.onBalanceChanged = (...rest) => onBalanceChanged(walletId, ...rest)
  }
  if (onBlockHeightChanged) {
    out.onBlockHeightChanged = (...rest) =>
      onBlockHeightChanged(walletId, ...rest)
  }
  if (onNewTransactions) {
    out.onNewTransactions = (...rest) => onNewTransactions(walletId, ...rest)
  }
  if (onTransactionsChanged) {
    out.onTransactionsChanged = (...rest) =>
      onTransactionsChanged(walletId, ...rest)
  }
  if (onWalletDataChanged) {
    out.onDataChanged = (...rest) => onWalletDataChanged(walletId, ...rest)
  }
  if (onWalletNameChanged) {
    out.onWalletNameChanged = (...rest) =>
      onWalletNameChanged(walletId, ...rest)
  }

  return out
}

/**
 * This is the data an account contains, and the methods to update it.
 */
class AccountState {
  constructor (ai, appId, loginTree, keyInfo, callbacks) {
    // Constant stuff:
    this.ai = ai
    this.appId = appId
    this.keyInfo = keyInfo
    this.callbacks = callbacks

    // Login state:
    this.loginTree = loginTree
    this.login = findAppLogin(loginTree, this.appId)
    this.legacyKeyInfos = []
    this.keyStates = {}

    // Wallet state:
    this.currencyWallets = {}
    this.currencyWalletsLoading = {}

    // Add the login to redux:
    const { dispatch } = ai.props
    dispatch({
      type: 'LOGIN',
      payload: {
        appId,
        username: loginTree.username,
        loginKey: this.login.loginKey
      }
    })
    this.activeLoginId = ai.props.state.login.lastActiveLoginId

    const { activeLoginId } = this
    dispatch({
      type: 'ACCOUNT_KEYS_LOADED',
      payload: { activeLoginId, walletInfos: this.allKeys }
    })
  }

  async logout () {
    const { activeLoginId } = this
    const { dispatch } = this.ai.props
    dispatch({ type: 'LOGOUT', payload: { activeLoginId } })

    // Shut down:
    dispatch(this.disposer)
    this.ai = null

    // Clear keys:
    this.appId = null
    this.keyInfo = null
    this.loginTree = null
    this.login = null
    this.legacyKeyInfos = null
    this.keyStates = null
  }

  changePassword (password, login = this.loginTree) {
    const { ai, loginTree: { username } } = this
    checkLogin(login)

    return makePasswordKit(ai, login, username, password).then(kit =>
      this.applyKit(kit)
    )
  }

  changePin (pin, login = this.login) {
    const { ai, loginTree: { username } } = this
    checkLogin(login)

    const kit = makePin2Kit(ai, login, username, pin)
    return this.applyKit(kit)
  }

  changeRecovery (questions, answers, login = this.loginTree) {
    const { ai, loginTree: { username } } = this
    checkLogin(login)

    const kit = makeRecovery2Kit(ai, login, username, questions, answers)
    return this.applyKit(kit)
  }

  applyKit (kit) {
    return applyKit(this.ai, this.loginTree, kit).then(loginTree => {
      this.loginTree = loginTree
      this.login = findAppLogin(loginTree, this.appId)

      // Update the key list in case something changed:
      const { activeLoginId, ai } = this
      ai.props.dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: { activeLoginId, walletInfos: this.allKeys }
      })
      this.updateCurrencyWallets()

      return this
    })
  }

  changeKeyStates (newStates) {
    const { ai, keyInfo, keyStates } = this
    return changeKeyStates(
      ai.props.state,
      keyInfo.id,
      keyStates,
      newStates
    ).then(keyStates => {
      this.keyStates = keyStates
      this.updateCurrencyWallets()
      if (this.callbacks.onKeyListChanged) {
        this.callbacks.onKeyListChanged()
      }
      return void 0
    })
  }

  reloadKeyStates () {
    const { ai, keyInfo, activeLoginId } = this
    return loadAllKeyStates(ai.props.state, keyInfo.id).then(values => {
      const { keyInfos, keyStates } = values
      this.legacyKeyInfos = keyInfos
      this.keyStates = keyStates

      const { dispatch } = ai.props
      dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: { activeLoginId, walletInfos: this.allKeys }
      })
      this.updateCurrencyWallets()

      return this
    })
  }

  async createCurrencyWallet (type, opts) {
    const { ai, login } = this

    // Make the keys:
    const plugin = getCurrencyPlugin(ai, type)
    const keys = opts.keys || plugin.createPrivateKey(type)
    const keyInfo = makeStorageKeyInfo(ai, type, keys)
    const kit = makeKeysKit(ai, login, keyInfo)

    // Add the keys to the login:
    await this.applyKit(kit)
    const wallet = await timeout(
      ai.waitFor(props => this.currencyWallets[keyInfo.id]),
      10000,
      new Error('Error creating wallet')
    )

    if (opts.name) await wallet.renameWallet(opts.name)
    if (opts.fiatCurrencyCode) {
      await ai.props.dispatch(
        ACTIONS.setCurrencyWalletFiat(keyInfo.id, opts.fiatCurrencyCode)
      )
    }

    return wallet
  }

  get allKeys () {
    const { appId, keyStates, legacyKeyInfos, login } = this
    const allKeys = mergeKeyInfos(softCat(legacyKeyInfos, login.keyInfos))

    return allKeys.map(info => ({
      appId,
      archived: false,
      deleted: false,
      sortIndex: allKeys.length,
      ...keyStates[info.id],
      ...info
    }))
  }

  updateCurrencyWallets () {
    const { activeLoginId, ai, login } = this

    // List all the wallets we can mangage:
    const allWalletIds =
      ai.props.state.login.logins[activeLoginId].currencyWalletIds

    // If there is a wallet we could be managing, but aren't, load it:
    for (const id of allWalletIds) {
      if (
        this.currencyWallets[id] == null &&
        !this.currencyWalletsLoading[id]
      ) {
        const walletInfo = login.keyInfos.find(info => info.id === id)
        const callbacks = makeCurrencyWalletCallbacks(id, this.callbacks)

        this.currencyWalletsLoading[id] = true
        makeCurrencyWalletApi(ai, walletInfo, callbacks)
          .then(wallet => {
            this.currencyWalletsLoading[id] = false
            this.currencyWallets[id] = wallet
            if (this.callbacks.onKeyListChanged) {
              this.callbacks.onKeyListChanged()
            }

            // Horrible hack used to kick `createCurrencyWallet` awake:
            ai.props.dispatch({
              type: 'ACCOUNT_KEYS_LOADED',
              payload: { activeLoginId, walletInfos: this.allKeys }
            })

            return null
          })
          .catch(e => ai.props.onError(e))
      }
    }

    // TODO: Unload deleted wallets
  }
}

export async function makeAccountState (ai, appId, loginTree, callbacks) {
  const { dispatch } = ai.props
  await waitForCurrencyPlugins(ai)

  return ensureAccountExists(ai, loginTree, appId).then(loginTree => {
    // Find our repo:
    const type = makeAccountType(appId)
    const login = findAppLogin(loginTree, appId)
    const keyInfo = findFirstKey(login.keyInfos, type)
    if (keyInfo == null) {
      throw new Error(`Cannot find a "${type}" repo`)
    }

    return dispatch(ACTIONS.addStorageWallet(keyInfo)).then(() => {
      const account = new AccountState(ai, appId, loginTree, keyInfo, callbacks)
      const disposer = dispatch(
        createReaction(
          state => getStorageWalletLastSync(state, keyInfo.id),
          () => account.reloadKeyStates()
        )
      )
      account.disposer = disposer
      return disposer.payload.out.then(() => account)
    })
  })
}

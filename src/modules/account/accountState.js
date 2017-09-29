import { createReaction } from '../../util/redux/reaction.js'
import { softCat } from '../../util/util.js'
import { addStorageWallet } from '../actions.js'
import { makeCurrencyWallet } from '../currencyWallets/api.js'
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
import {
  awaitPluginsLoaded,
  getStorageWalletLastSync,
  hasCurrencyPlugin
} from '../selectors.js'
import { changeKeyStates, loadAllKeyStates } from './keyState.js'

function findAppLogin (loginTree, appId) {
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
function createChildLogin (coreRoot, loginTree, login, appId, wantRepo = true) {
  const username = loginTree.username
  checkLogin(login)

  const opts = { pin: loginTree.pin }
  if (wantRepo) {
    opts.keyInfo = makeStorageKeyInfo(coreRoot, makeAccountType(appId))
  }
  return makeCreateKit(coreRoot, login, appId, username, opts).then(kit => {
    const parentKit = {
      serverPath: kit.serverPath,
      server: kit.server,
      login: { children: [kit.login] },
      stash: { children: [kit.stash] },
      loginId: login.loginId
    }
    return applyKit(coreRoot, loginTree, parentKit)
  })
}

/**
 * Ensures that the loginTree contains an account for the specified appId.
 * @return A `Promise`, which will resolve to a loginTree that does have
 * the requested account.
 */
function ensureAccountExists (coreRoot, loginTree, appId) {
  const accountType = makeAccountType(appId)

  // If there is no app login, make that:
  const login = findAppLogin(loginTree, appId)
  if (login == null) {
    return createChildLogin(coreRoot, loginTree, loginTree, appId, true)
  }

  // Otherwise, make the repo:
  if (findFirstKey(login.keyInfos, accountType) == null) {
    checkLogin(login)
    const keyInfo = makeStorageKeyInfo(coreRoot, accountType)
    const keysKit = makeKeysKit(coreRoot, login, keyInfo)
    return applyKit(coreRoot, loginTree, keysKit)
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
  constructor (coreRoot, appId, loginTree, keyInfo, callbacks) {
    // Constant stuff:
    this.coreRoot = coreRoot
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
  }

  async logout () {
    // Shut down:
    this.coreRoot.redux.dispatch(this.disposer)
    this.coreRoot = null

    // Clear keys:
    this.appId = null
    this.keyInfo = null
    this.loginTree = null
    this.login = null
    this.legacyKeyInfos = null
    this.keyStates = null
  }

  changePassword (password, login = this.loginTree) {
    const { coreRoot, loginTree: { username } } = this
    checkLogin(login)

    return makePasswordKit(coreRoot, login, username, password).then(kit =>
      this.applyKit(kit)
    )
  }

  changePin (pin, login = this.login) {
    const { coreRoot, loginTree: { username } } = this
    checkLogin(login)

    const kit = makePin2Kit(coreRoot, login, username, pin)
    return this.applyKit(kit)
  }

  changeRecovery (questions, answers, login = this.loginTree) {
    const { coreRoot, loginTree: { username } } = this
    checkLogin(login)

    const kit = makeRecovery2Kit(coreRoot, login, username, questions, answers)
    return this.applyKit(kit)
  }

  applyKit (kit) {
    return applyKit(this.coreRoot, this.loginTree, kit).then(loginTree => {
      this.loginTree = loginTree
      this.login = findAppLogin(loginTree, this.appId)
      this.updateCurrencyWallets()
      return this
    })
  }

  changeKeyStates (newStates) {
    const { coreRoot, keyInfo, keyStates } = this
    return changeKeyStates(
      coreRoot.redux.getState(),
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
    const { coreRoot, keyInfo } = this
    return loadAllKeyStates(
      coreRoot.redux.getState(),
      keyInfo.id
    ).then(values => {
      const { keyInfos, keyStates } = values
      this.legacyKeyInfos = keyInfos
      this.keyStates = keyStates
      this.updateCurrencyWallets()
      return this
    })
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

  get activeWalletIds () {
    const { coreRoot } = this
    return this.allKeys
      .filter(
        info =>
          !info.deleted &&
          !info.archived &&
          hasCurrencyPlugin(coreRoot.redux.getState(), info.type)
      )
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(info => info.id)
  }

  get archivedWalletIds () {
    const { coreRoot } = this
    return this.allKeys
      .filter(
        info =>
          !info.deleted &&
          info.archived &&
          hasCurrencyPlugin(coreRoot.redux.getState(), info.type)
      )
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(info => info.id)
  }

  updateCurrencyWallets () {
    const { coreRoot, login } = this

    // List all the wallets we can mangage:
    const allWalletIds = [...this.activeWalletIds, ...this.archivedWalletIds]

    // If there is a wallet we could be managing, but aren't, load it:
    for (const id of allWalletIds) {
      if (
        this.currencyWallets[id] == null &&
        !this.currencyWalletsLoading[id]
      ) {
        const walletInfo = login.keyInfos.find(info => info.id === id)
        const callbacks = makeCurrencyWalletCallbacks(id, this.callbacks)

        this.currencyWalletsLoading[id] = true
        makeCurrencyWallet(walletInfo, { callbacks, coreRoot })
          .then(wallet => {
            this.currencyWalletsLoading[id] = false
            this.currencyWallets[id] = wallet
            if (this.callbacks.onKeyListChanged) {
              this.callbacks.onKeyListChanged()
            }
            return null
          })
          .catch(e => coreRoot.onError(e))
      }
    }

    // TODO: Unload deleted wallets
  }
}

export async function makeAccountState (coreRoot, appId, loginTree, callbacks) {
  await awaitPluginsLoaded(coreRoot.redux)

  return ensureAccountExists(coreRoot, loginTree, appId).then(loginTree => {
    // Find our repo:
    const type = makeAccountType(appId)
    const login = findAppLogin(loginTree, appId)
    const keyInfo = findFirstKey(login.keyInfos, type)
    if (keyInfo == null) {
      throw new Error(`Cannot find a "${type}" repo`)
    }

    return coreRoot.redux.dispatch(addStorageWallet(keyInfo)).then(() => {
      const account = new AccountState(
        coreRoot,
        appId,
        loginTree,
        keyInfo,
        callbacks
      )
      const disposer = coreRoot.redux.dispatch(
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

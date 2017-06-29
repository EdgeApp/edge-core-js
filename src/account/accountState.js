import { makeCreateKit } from '../login/create.js'
import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo
} from '../login/keys.js'
import { applyKit, searchTree } from '../login/login.js'
import { makePasswordKit } from '../login/password.js'
import { makePin2Kit } from '../login/pin2.js'
import { makeRecovery2Kit } from '../login/recovery2.js'
import { addStorageWallet } from '../redux/actions.js'
import { getStorageWalletLastSync } from '../redux/selectors.js'
import { createReaction } from '../util/reaction.js'
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
function createChildLogin (io, loginTree, login, appId, wantRepo = true) {
  const username = loginTree.username
  checkLogin(login)

  const opts = { pin: loginTree.pin }
  if (wantRepo) {
    const keyInfo = makeStorageKeyInfo(io, makeAccountType(appId))
    opts.keysKit = makeKeysKit(io, login, keyInfo)
  }
  return makeCreateKit(io, login, appId, username, opts).then(kit =>
    applyKit(io, loginTree, kit)
  )
}

/**
 * Ensures that the loginTree contains an account for the specified appId.
 * @return A `Promise`, which will resolve to a loginTree that does have
 * the requested account.
 */
function ensureAccountExists (io, loginTree, appId) {
  const accountType = makeAccountType(appId)

  // If there is no app login, make that:
  const login = findAppLogin(loginTree, appId)
  if (login == null) {
    return createChildLogin(io, loginTree, loginTree, appId, true)
  }

  // Otherwise, make the repo:
  if (findFirstKey(login.keyInfos, accountType) == null) {
    checkLogin(login)
    const keyInfo = makeStorageKeyInfo(io, accountType)
    const keysKit = makeKeysKit(io, login, keyInfo)
    return applyKit(io, loginTree, keysKit)
  }

  // Everything is fine, so do nothing:
  return Promise.resolve(loginTree)
}

/**
 * This is the data an account contains, and the methods to update it.
 */
class AccountState {
  constructor (io, appId, loginTree, keyInfo) {
    // Constant stuff:
    this.io = io
    this.appId = appId
    this.keyInfo = keyInfo

    // Login state:
    this.loginTree = loginTree
    this.login = findAppLogin(loginTree, this.appId)
    this.legacyKeyInfos = []
    this.keyStates = {}
  }

  changePassword (password, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    return makePasswordKit(io, login, username, password).then(kit =>
      this.applyKit(kit)
    )
  }

  changePin (pin, login = this.login) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    const kit = makePin2Kit(io, login, username, pin)
    return this.applyKit(kit)
  }

  changeRecovery (questions, answers, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    const kit = makeRecovery2Kit(io, login, username, questions, answers)
    return this.applyKit(kit)
  }

  applyKit (kit) {
    return applyKit(this.io, this.loginTree, kit).then(loginTree => {
      this.loginTree = loginTree
      this.login = findAppLogin(loginTree, this.appId)
      return this
    })
  }

  changeKeyStates (newStates) {
    const { io, keyInfo, keyStates } = this
    return changeKeyStates(
      io.redux.getState(),
      keyInfo.id,
      keyStates,
      newStates
    ).then(keyStates => {
      this.keyStates = keyStates
      return void 0
    })
  }

  reloadKeyStates () {
    const { io, keyInfo } = this
    return loadAllKeyStates(io.redux.getState(), keyInfo.id).then(values => {
      const { keyInfos, keyStates } = values
      this.legacyKeyInfos = keyInfos
      this.keyStates = keyStates
      return this
    })
  }
}

export function makeAccountState (io, appId, loginTree) {
  return ensureAccountExists(io, loginTree, appId).then(loginTree => {
    // Find our repo:
    const type = makeAccountType(appId)
    const login = findAppLogin(loginTree, appId)
    const keyInfo = findFirstKey(login.keyInfos, type)
    if (keyInfo == null) {
      throw new Error(`Cannot find a "${type}" repo`)
    }

    return io.redux.dispatch(addStorageWallet(keyInfo)).then(() => {
      const account = new AccountState(io, appId, loginTree, keyInfo)
      const disposer = io.redux.dispatch(
        createReaction(
          state => getStorageWalletLastSync(state, keyInfo.id),
          () => account.reloadKeyStates()
        )
      )
      return disposer.payload.out.then(() => account)
    })
  })
}

import { makeCreateKit } from './create.js'
import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo
} from './keys.js'
import { applyKit, searchTree } from './login.js'
import { makePasswordKit } from './password.js'
import { makePin2Kit } from './pin2.js'
import { makeRecovery2Kit } from './recovery2.js'

function checkLogin (login) {
  if (login == null || login.loginKey == null) {
    throw new Error('Incomplete login')
  }
}

/**
 * Stores a login object on behalf of the account,
 * and handles various updates.
 */
export class LoginState {
  constructor (io, loginTree) {
    this.io = io
    this.update(loginTree)
  }

  /**
   * Ensures that the login has a particular child login.
   */
  ensureLogin (appId, login = this.loginTree, wantRepo = true) {
    if (this.findLogin(appId) != null) {
      return Promise.resolve(this)
    }

    const { io, loginTree, loginTree: { username } } = this
    checkLogin(login)

    const opts = { pin: loginTree.pin }
    if (wantRepo) {
      const keyInfo = makeStorageKeyInfo(io, makeAccountType(login.appId))
      opts.keysKit = makeKeysKit(io, login, keyInfo)
    }
    return makeCreateKit(io, login, appId, username, opts).then(kit =>
      this.applyKit(kit)
    )
  }

  /**
   * Ensures that the given login has an account repo.
   */
  ensureAccountRepo (login) {
    const accountType = makeAccountType(login.appId)
    if (findFirstKey(login.keyInfos, accountType) != null) {
      return Promise.resolve(this)
    }

    const { io } = this
    checkLogin(login)

    const keyInfo = makeStorageKeyInfo(io, accountType)
    return this.applyKit(makeKeysKit(io, login, keyInfo))
  }

  changePassword (password, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    return makePasswordKit(io, login, username, password).then(kit =>
      this.applyKit(kit)
    )
  }

  changePin (pin, login = this.loginTree) {
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

  findLogin (appId) {
    return searchTree(this.loginTree, login => login.appId === appId)
  }

  // Internal helper functions
  applyKit (kit) {
    return applyKit(this.io, this.loginTree, kit).then(loginTree =>
      this.update(loginTree)
    )
  }

  update (loginTree) {
    this.loginTree = loginTree
    return this
  }
}

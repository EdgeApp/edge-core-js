import { makeCreateKit } from './create.js'
import { makeAccountType, makeRepoKit } from './keys.js'
import { dispatchKit, searchTree } from './login.js'
import { makePasswordKit } from './password.js'
import { makePin2Kit } from './pin2.js'
import { makeRecovery2Kit } from './recovery2.js'

function findKeyInfo (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

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
      opts.keysKit = makeRepoKit(io, login, makeAccountType(appId))
    }
    return makeCreateKit(io, login, appId, username, opts).then(kit =>
      this.dispatchKit(login, kit)
    )
  }

  /**
   * Ensures that the given login has an account repo.
   */
  ensureAccountRepo (login) {
    const accountType = makeAccountType(login.appId)
    if (findKeyInfo(login, accountType) != null) {
      return Promise.resolve(this)
    }

    const { io } = this
    checkLogin(login)

    const kit = makeRepoKit(io, login, accountType)
    return this.dispatchKit(login, kit)
  }

  changePassword (password, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    return makePasswordKit(io, login, username, password).then(kit =>
      this.dispatchKit(login, kit)
    )
  }

  changePin (pin, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    const kit = makePin2Kit(io, login, username, pin)
    return this.dispatchKit(login, kit)
  }

  changeRecovery (questions, answers, login = this.loginTree) {
    const { io, loginTree: { username } } = this
    checkLogin(login)

    const kit = makeRecovery2Kit(io, login, username, questions, answers)
    return this.dispatchKit(login, kit)
  }

  findLogin (appId) {
    return searchTree(this.loginTree, login => login.appId === appId)
  }

  // Internal helper functions
  dispatchKit (login, kit) {
    return dispatchKit(this.io, this.loginTree, login, kit).then(loginTree =>
      this.update(loginTree)
    )
  }

  update (loginTree) {
    this.loginTree = loginTree
    return this
  }
}

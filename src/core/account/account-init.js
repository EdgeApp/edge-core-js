// @flow

import { type EdgeAccount, type EdgeAccountOptions } from '../../types/types.js'
import { type LoginCreateOpts, makeCreateKit } from '../login/create.js'
import {
  findFirstKey,
  makeAccountType,
  makeKeysKit,
  makeStorageKeyInfo
} from '../login/keys.js'
import { type LoginTree } from '../login/login-types.js'
import { applyKit, searchTree } from '../login/login.js'
import { type ApiInput } from '../root-pixie.js'

function checkLogin (login: LoginTree) {
  if (login == null || login.loginKey == null) {
    throw new Error('Incomplete login')
  }
}

export function findAppLogin (loginTree: LoginTree, appId: string): LoginTree {
  const out = searchTree(loginTree, login => login.appId === appId)
  if (!out) throw new Error(`Internal error: cannot find login for ${appId}`)
  return out
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
 * Creates an `EdgeAccount` API object.
 */
export async function makeAccount (
  ai: ApiInput,
  appId: string,
  loginTree: LoginTree,
  loginType: string = '',
  opts: EdgeAccountOptions = {}
): Promise<EdgeAccount> {
  const io = ai.props.io
  io.console.info(`Login: decrypted keys for user ${loginTree.loginId}`)

  return ensureAccountExists(ai, loginTree, appId).then(loginTree => {
    io.console.info('Login: account exists for appId')
    const { username } = loginTree
    if (!username) throw new Error('Cannot log in: missing username')

    // Add the login to redux:
    const rootLogin = loginTree.loginKey != null
    ai.props.dispatch({
      type: 'LOGIN',
      payload: {
        appId,
        username,
        loginKey: rootLogin
          ? loginTree.loginKey
          : findAppLogin(loginTree, appId).loginKey,
        rootLogin,
        loginType
      }
    })

    return waitForAccount(ai, ai.props.state.lastAccountId)
  })
}

/**
 * Waits for the account API to appear and returns it.
 */
export function waitForAccount (ai: ApiInput, accountId: string) {
  const out: any = ai.waitFor(props => {
    const selfState = props.state.accounts[accountId]
    if (selfState.loadFailure != null) throw selfState.loadFailure

    const selfOutput = props.output.accounts[accountId]
    if (selfOutput != null && selfOutput.api != null) return selfOutput.api
  })
  return out
}

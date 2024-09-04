import { base64 } from 'rfc4648'

import { EdgeAccount, EdgeAccountOptions } from '../../types/types'
import { LoginCreateOpts, makeCreateKit } from '../login/create'
import {
  findFirstKey,
  makeAccountType,
  makeKeyInfo,
  makeKeysKit
} from '../login/keys'
import { applyKit, searchTree } from '../login/login'
import { LoginStash } from '../login/login-stash'
import { LoginKit, LoginTree, LoginType } from '../login/login-types'
import { createStorageKeys, wasEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput, RootProps } from '../root-pixie'

function checkLogin(login: LoginTree): void {
  if (login == null || login.loginKey == null) {
    throw new Error('Incomplete login')
  }
}

export function findAppLogin(loginTree: LoginTree, appId: string): LoginTree {
  const out = searchTree(loginTree, login => login.appId === appId)
  if (out == null) {
    throw new Error(`Internal error: cannot find login for ${appId}`)
  }
  return out
}

/**
 * Creates a child login under the provided login, with the given appId.
 */
async function createChildLogin(
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree,
  appId: string
): Promise<LoginTree> {
  checkLogin(login)

  const opts: LoginCreateOpts = {
    pin: loginTree.pin,
    username: loginTree.username
  }
  opts.keyInfo = makeKeyInfo(
    makeAccountType(appId),
    wasEdgeStorageKeys(createStorageKeys(ai))
  )
  const kit = await makeCreateKit(ai, login, appId, opts)
  const parentKit: LoginKit = {
    login: { children: [kit.login as LoginTree] },
    loginId: login.loginId,
    server: kit.server,
    serverPath: kit.serverPath,
    stash: { children: [kit.stash as LoginStash] }
  }
  return await applyKit(ai, loginTree, parentKit)
}

/**
 * Ensures that the loginTree contains an account for the specified appId.
 * @return A `Promise`, which will resolve to a loginTree that does have
 * the requested account.
 */
export async function ensureAccountExists(
  ai: ApiInput,
  loginTree: LoginTree,
  appId: string
): Promise<LoginTree> {
  // For crash errors:
  ai.props.log.breadcrumb('ensureAccountExists', {})

  const accountType = makeAccountType(appId)

  // If there is no app login, make that:
  const login = searchTree(loginTree, login => login.appId === appId)
  if (login == null) {
    // For crash errors:
    ai.props.log.breadcrumb('createChildLogin', {})
    return await createChildLogin(ai, loginTree, loginTree, appId)
  }

  // Otherwise, make the repo:
  if (findFirstKey(login.keyInfos, accountType) == null) {
    // For crash errors:
    ai.props.log.breadcrumb('createAccountRepo', {})
    checkLogin(login)
    const keyInfo = makeKeyInfo(
      accountType,
      wasEdgeStorageKeys(createStorageKeys(ai))
    )
    const keysKit = makeKeysKit(ai, login, [keyInfo])
    return await applyKit(ai, loginTree, keysKit)
  }

  // Everything is fine, so do nothing:
  return loginTree
}

/**
 * Creates an `EdgeAccount` API object.
 */
export async function makeAccount(
  ai: ApiInput,
  appId: string,
  loginTree: LoginTree,
  loginType: LoginType,
  opts: EdgeAccountOptions
): Promise<EdgeAccount> {
  // For crash errors:
  ai.props.log.breadcrumb('makeAccount', {})

  const { pauseWallets = false } = opts
  const { log } = ai.props
  log.warn(
    `Login: decrypted keys for user ${base64.stringify(loginTree.loginId)}`
  )

  loginTree = await ensureAccountExists(ai, loginTree, appId)
  log.warn('Login: account exists for appId')

  // Add the login to redux:
  const hasRootKey = loginTree.loginKey != null
  ai.props.dispatch({
    type: 'LOGIN',
    payload: {
      appId,
      hasRootKey,
      loginKey: hasRootKey
        ? loginTree.loginKey
        : findAppLogin(loginTree, appId).loginKey,
      loginType,
      pauseWallets,
      rootLoginId: loginTree.loginId
    }
  })

  return await waitForAccount(ai, ai.props.state.lastAccountId)
}

/**
 * Waits for the account API to appear and returns it.
 */
export function waitForAccount(
  ai: ApiInput,
  accountId: string
): Promise<EdgeAccount> {
  const out: Promise<EdgeAccount> = ai.waitFor(
    (props: RootProps): EdgeAccount | undefined => {
      const accountState = props.state.accounts[accountId]
      if (accountState.loadFailure != null) throw accountState.loadFailure

      const accountOutput = props.output.accounts[accountId]
      if (accountOutput?.accountApi != null) {
        return accountOutput.accountApi
      }
    }
  )
  return out
}

import { base64 } from 'rfc4648'

import { EdgeAccount, EdgeAccountOptions } from '../../types/types'
import { decryptText } from '../../util/crypto/crypto'
import { makeCreateKit } from '../login/create'
import {
  decryptKeyInfos,
  findFirstKey,
  makeAccountType,
  makeKeyInfo,
  makeKeysKit
} from '../login/keys'
import { applyKit, decryptChildKey, searchTree } from '../login/login'
import { getStashById } from '../login/login-selectors'
import { LoginStash } from '../login/login-stash'
import { LoginKit, LoginType, SessionKey } from '../login/login-types'
import { createStorageKeys, wasEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput, RootProps } from '../root-pixie'

/**
 * Creates a child login under the provided login, with the given appId.
 */
async function createChildLogin(
  ai: ApiInput,
  stashTree: LoginStash,
  sessionKey: SessionKey,
  appId: string
): Promise<LoginStash> {
  let pin: string | undefined
  if (stashTree.pin2TextBox != null) {
    pin = decryptText(stashTree.pin2TextBox, sessionKey.loginKey)
  }

  const { kit } = await makeCreateKit(ai, sessionKey, appId, {
    keyInfo: makeKeyInfo(
      makeAccountType(appId),
      wasEdgeStorageKeys(createStorageKeys(ai))
    ),
    pin,
    username: stashTree.username
  })
  const parentKit: LoginKit = {
    loginId: sessionKey.loginId,
    server: kit.server,
    serverPath: kit.serverPath,
    stash: { children: [kit.stash as LoginStash] }
  }
  return await applyKit(ai, sessionKey, parentKit)
}

/**
 * Ensures that the loginTree contains an account for the specified appId.
 * @return A `Promise`, which will resolve to a loginTree that does have
 * the requested account.
 */
export async function ensureAccountExists(
  ai: ApiInput,
  stashTree: LoginStash,
  sessionKey: SessionKey,
  appId: string
): Promise<LoginStash> {
  const { log } = ai.props

  // If there is no app login, make that:
  const appStash = searchTree(stashTree, stash => stash.appId === appId)
  if (appStash == null) {
    // For crash errors:
    ai.props.log.breadcrumb('createChildLogin', {})

    return await createChildLogin(ai, stashTree, sessionKey, appId)
  }

  // Decrypt the wallet keys:
  // TODO: Once we cache public keys, use those instead:
  const appKey = decryptChildKey(stashTree, sessionKey, appStash.loginId)
  const keyInfos = decryptKeyInfos(appStash, appKey.loginKey)
  log.warn(
    `Login: decrypted keys for user ${base64.stringify(stashTree.loginId)}`
  )

  // If the account has no repo, make one:
  const accountType = makeAccountType(appId)
  if (findFirstKey(keyInfos, accountType) == null) {
    // For crash errors:
    ai.props.log.breadcrumb('createAccountRepo', {})

    const keyInfo = makeKeyInfo(
      accountType,
      wasEdgeStorageKeys(createStorageKeys(ai))
    )
    const keysKit = makeKeysKit(ai, appKey, [keyInfo])
    return await applyKit(ai, sessionKey, keysKit)
  }

  // Everything is fine, so do nothing:
  return stashTree
}

/**
 * Creates an `EdgeAccount` API object.
 */
export async function makeAccount(
  ai: ApiInput,
  sessionKey: SessionKey,
  loginType: LoginType,
  opts: EdgeAccountOptions & { duressMode?: boolean }
): Promise<EdgeAccount> {
  const { pauseWallets = false } = opts
  // Override the appId if duress mode is enabled:
  const appId =
    opts.duressMode === true
      ? ai.props.state.login.contextAppId + '.duress'
      : ai.props.state.login.contextAppId
  const { log } = ai.props

  // For crash errors:
  ai.props.log.breadcrumb('makeAccount', {})

  // Create the loginTree:
  const { stashTree } = getStashById(ai, sessionKey.loginId)
  await ensureAccountExists(ai, stashTree, sessionKey, appId)
  log.warn('Login: account exists for appId')

  // Add the login to redux:
  ai.props.dispatch({
    type: 'LOGIN',
    payload: {
      appId,
      loginType,
      pauseWallets,
      rootLoginId: stashTree.loginId,
      sessionKey
    }
  })

  return await waitForAccount(ai, ai.props.state.lastAccountId)
}

/**
 * Waits for the account API to appear and returns it.
 */
function waitForAccount(ai: ApiInput, accountId: string): Promise<EdgeAccount> {
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

/**
 * Functions for working with login data in its on-disk format.
 */

import { asBoolean } from 'cleaners'
import { base64 } from 'rfc4648'

import { asLoginPayload } from '../../types/server-cleaners'
import { LoginPayload, LoginRequestBody } from '../../types/server-types'
import {
  asMaybeOtpError,
  EdgeAccountOptions,
  EdgeWalletInfo
} from '../../types/types'
import { decrypt, decryptText } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { verifyData } from '../../util/crypto/verify'
import { utf8 } from '../../util/encoding'
import { softCat } from '../../util/util'
import { ApiInput } from '../root-pixie'
import {
  fixWalletInfo,
  makeAccountType,
  makeKeyInfo,
  mergeKeyInfos
} from './keys'
import { loginFetch } from './login-fetch'
import { makeSecretKit } from './login-secret'
import { getStashById } from './login-selectors'
import { LoginStash, saveStash } from './login-stash'
import { asEdgeWalletInfo, LoginKit, LoginTree } from './login-types'
import { getLoginOtp, getStashOtp } from './otp'

/**
 * Returns the login that satisfies the given predicate,
 * or undefined if nothing matches.
 */
export function searchTree<T>(
  node: T,
  predicate: (node: T) => boolean
): T | undefined {
  if (predicate(node)) return node

  const flowHack: any = node
  if (flowHack.children != null) {
    for (const child of flowHack.children) {
      const out = searchTree(child, predicate)
      if (out != null) return out
    }
  }
}

/**
 * Walks a tree, building a new tree.
 * The `predicate` callback returns true when we reach the node to replace,
 * and the `update` callback replaces that node.
 * The `clone` callback updates the `children` on the non-replaced nodes.
 */
function updateTree<Node extends { readonly children?: any[] }, Output>(
  node: Node,
  predicate: (node: Node) => boolean,
  update: (node: Node) => Output,
  clone: (node: Node, children: Output[]) => Output
): Output {
  if (predicate(node)) return update(node)

  const children: Output[] =
    node.children != null
      ? node.children.map(child => updateTree(child, predicate, update, clone))
      : []

  return clone(node, children)
}

function applyLoginPayloadInner(
  stash: LoginStash,
  loginKey: Uint8Array,
  loginReply: LoginPayload
): LoginStash {
  const { children: stashChildren = [] } = stash

  const {
    appId,
    created,
    loginId,
    loginAuthBox,
    userId,
    otpKey,
    otpResetDate,
    otpTimeout,
    pendingVouchers,
    parentBox,
    passwordAuthBox,
    passwordAuthSnrp,
    passwordBox,
    passwordKeySnrp,
    pin2TextBox,
    children = [],
    keyBoxes = [],
    mnemonicBox,
    rootKeyBox,
    syncKeyBox,
    syncToken
  } = loginReply

  const out: LoginStash = {
    appId,
    created,
    loginId,
    loginAuthBox,
    userId,
    otpKey: otpKey === true ? stash.otpKey : otpKey,
    otpResetDate,
    otpTimeout,
    pendingVouchers,
    parentBox,
    passwordAuthBox,
    passwordAuthSnrp,
    passwordBox: passwordBox === true ? stash.passwordBox : passwordBox,
    passwordKeySnrp,
    pin2TextBox,
    keyBoxes, // We should be more picky about these
    mnemonicBox,
    rootKeyBox,
    syncKeyBox,
    syncToken
  }

  // Preserve client-only data:
  if (stash.lastLogin != null) out.lastLogin = stash.lastLogin
  if (stash.username != null) out.username = stash.username
  if (stash.userId != null && out.userId == null) out.userId = stash.userId

  // Store the pin key unencrypted:
  if (loginReply.pin2KeyBox != null) {
    out.pin2Key = decrypt(loginReply.pin2KeyBox, loginKey)
  }

  // Store the recovery key unencrypted:
  if (loginReply.recovery2KeyBox != null) {
    out.recovery2Key = decrypt(loginReply.recovery2KeyBox, loginKey)
  }

  // Sort children oldest to newest:
  children.sort((a, b) => a.created.valueOf() - b.created.valueOf())

  // Recurse into children:
  out.children = children.map(child => {
    const { appId, loginId, parentBox } = child

    // Read the decryption key:
    if (parentBox == null) {
      throw new Error('Key integrity violation: No parentBox on child login.')
    }
    const childKey = decrypt(parentBox, loginKey)

    // Find a stash to merge with:
    const existingChild = stashChildren.find(child =>
      verifyData(child.loginId, loginId)
    )
    const childStash = existingChild ?? {
      appId,
      loginId,
      pendingVouchers: []
    }

    return applyLoginPayloadInner(childStash, childKey, child)
  })

  // Check for missing children:
  for (const { loginId } of stashChildren) {
    const replyChild = children.find(child =>
      verifyData(child.loginId, loginId)
    )
    if (replyChild == null) {
      throw new Error('The server has lost children!')
    }
  }

  return out
}

/**
 * Updates the given login stash object with fields from the auth server.
 * TODO: We don't trust the auth server 100%, so be picky about what we copy.
 */
export function applyLoginPayload(
  stashTree: LoginStash,
  loginKey: Uint8Array,
  loginReply: LoginPayload
): LoginStash {
  return updateTree(
    stashTree,
    stash => stash.appId === loginReply.appId,
    stash => applyLoginPayloadInner(stash, loginKey, loginReply),
    (stash, children) => ({ ...stash, children })
  )
}

function makeLoginTreeInner(
  stash: LoginStash,
  loginKey: Uint8Array
): LoginTree {
  const {
    appId,
    created,
    lastLogin = new Date(),
    loginId,
    otpKey,
    otpResetDate,
    otpTimeout,
    pendingVouchers,
    userId,
    username,
    children: stashChildren = [],
    keyBoxes = []
  } = stash

  const login: LoginTree = {
    appId,
    created,
    isRoot: stash.parentBox == null,
    lastLogin,
    loginId,
    loginKey,
    otpKey,
    otpResetDate,
    otpTimeout,
    pendingVouchers,
    userId,
    username,
    children: [],
    keyInfos: []
  }

  // Server authentication:
  if (stash.loginAuthBox != null) {
    login.loginAuth = decrypt(stash.loginAuthBox, loginKey)
  }
  if (stash.passwordAuthBox != null) {
    if (login.userId == null) login.userId = loginId
    login.passwordAuth = decrypt(stash.passwordAuthBox, loginKey)
  }
  if (login.loginAuth == null && login.passwordAuth == null) {
    throw new Error('No server authentication methods on login')
  }

  // PIN v2:
  login.pin2Key = stash.pin2Key
  if (stash.pin2TextBox != null) {
    login.pin = decryptText(stash.pin2TextBox, loginKey)
  }

  // Recovery v2:
  login.recovery2Key = stash.recovery2Key

  const legacyKeys: EdgeWalletInfo[] = []

  // BitID wallet:
  const { mnemonicBox, rootKeyBox } = stash
  if (mnemonicBox != null && rootKeyBox != null) {
    const rootKey = decrypt(rootKeyBox, loginKey)
    const infoKey = hmacSha256(rootKey, utf8.parse('infoKey'))
    const keys = {
      mnemonic: decryptText(mnemonicBox, infoKey),
      rootKey: base64.stringify(rootKey)
    }
    legacyKeys.push(makeKeyInfo('wallet:bitid', keys, rootKey))
  }

  // Account settings:
  if (stash.syncKeyBox != null) {
    const syncKey = decrypt(stash.syncKeyBox, loginKey)
    const type = makeAccountType(login.appId)
    const keys = {
      syncKey: base64.stringify(syncKey),
      dataKey: base64.stringify(loginKey)
    }
    legacyKeys.push(makeKeyInfo(type, keys, loginKey))
  }

  // Keys:
  const keyInfos = keyBoxes.map(box =>
    asEdgeWalletInfo(JSON.parse(decryptText(box, loginKey)))
  )
  login.keyInfos = mergeKeyInfos([...legacyKeys, ...keyInfos]).map(walletInfo =>
    fixWalletInfo(walletInfo)
  )

  // Recurse into children:
  login.children = stashChildren.map(child => {
    if (child.parentBox == null) {
      throw new Error('Key integrity violation: No parentBox on child login.')
    }
    const childKey = decrypt(child.parentBox, loginKey)
    return makeLoginTreeInner(child, childKey)
  })

  return login
}

/**
 * Converts a login stash into an in-memory login object.
 */
export function makeLoginTree(
  stashTree: LoginStash,
  loginKey: Uint8Array,
  appId: string = ''
): LoginTree {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => makeLoginTreeInner(stash, loginKey),
    (stash, children): LoginTree => {
      const {
        appId,
        lastLogin = new Date(),
        loginId,
        pendingVouchers,
        username
      } = stash

      // Hack: The types say this must be present,
      // but we don't actually have a root key for child logins.
      // This affects everybody, so fixing it will be quite hard:
      const loginKey: any = undefined

      return {
        appId,
        children,
        isRoot: stash.parentBox == null,
        keyInfos: [],
        lastLogin,
        loginId,
        loginKey,
        pendingVouchers,
        username
      }
    }
  )
}

/**
 * Prepares a login stash for edge login,
 * stripping out any information that the target app is not allowed to see.
 */
export function sanitizeLoginStash(
  stashTree: LoginStash,
  appId: string
): LoginStash {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => stash,
    (stash, children): LoginStash => {
      const { appId, loginId, username } = stash
      return {
        appId,
        children,
        loginId,
        pendingVouchers: [],
        username
      }
    }
  )
}

/**
 * Logs a user in, using the auth server to retrieve information.
 * The various login methods (password / PIN / recovery, etc.) share
 * common logic, which all lives in here.
 *
 * The things tha differ between the methods are the server payloads
 * and the decryption steps, so this function accepts those two things
 * as parameters, plus the ordinary login options.
 */
export async function serverLogin(
  ai: ApiInput,
  stashTree: LoginStash,
  stash: LoginStash,
  opts: EdgeAccountOptions,
  serverAuth: LoginRequestBody,
  decrypt: (reply: LoginPayload) => Promise<Uint8Array>
): Promise<LoginTree> {
  const { now = new Date() } = opts
  const { deviceDescription } = ai.props.state.login

  const request: LoginRequestBody = {
    challengeId: opts.challengeId,
    otp: getStashOtp(stash, opts),
    voucherId: stash.voucherId,
    voucherAuth: stash.voucherAuth,
    ...serverAuth
  }
  if (deviceDescription != null) request.deviceDescription = deviceDescription

  let loginReply = asLoginPayload(
    await loginFetch(ai, 'POST', '/v2/login', request).catch(
      (error: unknown) => {
        // Save the username / voucher if we get an OTP error:
        const otpError = asMaybeOtpError(error)
        if (
          otpError != null &&
          // We have never seen this user before:
          ((stash.loginId.length === 0 && otpError.loginId != null) ||
            // We got a voucher:
            (otpError.voucherId != null && otpError.voucherAuth != null))
        ) {
          if (otpError.loginId != null) {
            stash.loginId = base64.parse(otpError.loginId)
          }
          if (otpError.voucherAuth != null) {
            stash.voucherId = otpError.voucherId
            stash.voucherAuth = base64.parse(otpError.voucherAuth)
          }
          stashTree.lastLogin = now
          saveStash(ai, stashTree).catch(() => {})
        }
        throw error
      }
    )
  )

  // Try decrypting the reply:
  const loginKey = await decrypt(loginReply)

  // Save the latest data:
  stashTree = applyLoginPayload(stashTree, loginKey, loginReply)
  stashTree.lastLogin = now
  await saveStash(ai, stashTree)

  // Ensure the account has secret-key login enabled:
  if (loginReply.loginAuthBox == null) {
    const { loginId } = loginReply
    const { stash, stashTree } = getStashById(ai, loginId)
    const secretKit = makeSecretKit(ai, { loginId, loginKey })
    const request: LoginRequestBody = {
      ...serverAuth,
      otp: getStashOtp(stash, opts),
      data: secretKit.server
    }
    loginReply = asLoginPayload(
      await loginFetch(ai, 'POST', secretKit.serverPath, request)
    )
    await saveStash(ai, applyLoginPayload(stashTree, loginKey, loginReply))
  }

  return makeLoginTree(stashTree, loginKey, stash.appId)
}

/**
 * Changing a login involves updating the server, the in-memory login,
 * and the on-disk stash. A login kit contains all three elements,
 * and this function knows how to apply them all.
 */
export async function applyKit(
  ai: ApiInput,
  loginTree: LoginTree,
  kit: LoginKit
): Promise<LoginTree> {
  const { loginId, serverMethod = 'POST', serverPath } = kit
  const login = searchTree(loginTree, login =>
    verifyData(login.loginId, loginId)
  )
  if (login == null) throw new Error('Cannot apply kit: missing login')

  const { stashTree } = getStashById(ai, loginId)
  const request = makeAuthJson(stashTree, login)
  request.data = kit.server
  await loginFetch(ai, serverMethod, serverPath, request)
  const newLoginTree = updateTree(
    loginTree,
    login => verifyData(login.loginId, loginId),
    login => ({
      ...login,
      ...kit.login,
      children: softCat(login.children, kit.login.children),
      keyInfos: mergeKeyInfos(softCat(login.keyInfos, kit.login.keyInfos))
    }),
    (login, children) => ({ ...login, children })
  )

  const newStashTree = updateTree(
    stashTree,
    stash => verifyData(stash.loginId, loginId),
    (stash): LoginStash => ({
      ...stash,
      ...kit.stash,
      children: softCat(stash.children, kit.stash.children),
      keyBoxes: softCat(stash.keyBoxes, kit.stash.keyBoxes)
    }),
    (stash, children) => ({ ...stash, children })
  )
  await saveStash(ai, newStashTree)

  return newLoginTree
}

/**
 * Applies an array of kits to a login, one after another.
 * We can't use `Promise.all`, since `applyKit` doesn't handle
 * parallelism correctly. Also, we want to stop if there are errors
 * (such as failing to change the root username).
 */
export async function applyKits(
  ai: ApiInput,
  loginTree: LoginTree,
  kits: Array<LoginKit | undefined>
): Promise<void> {
  for (const kit of kits) {
    if (kit == null) continue
    await applyKit(ai, loginTree, kit)
  }
}

/**
 * Refreshes a login with data from the server.
 */
export async function syncLogin(
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree
): Promise<LoginTree> {
  const { stashTree, stash } = getStashById(ai, login.loginId)

  // First, hit the fast endpoint to see if we even need to sync:
  const { syncToken } = stash
  if (syncToken != null) {
    try {
      const reply = await loginFetch(ai, 'POST', '/v2/sync', {
        loginId: stash.loginId,
        syncToken
      })
      if (asBoolean(reply)) return loginTree
    } catch (error) {
      // We can fall back on a full sync if we fail here.
    }
  }

  // If we do need to sync, prepare for a full login:
  const request = makeAuthJson(stashTree, login)
  const opts: EdgeAccountOptions = {
    // Avoid updating the lastLogin date:
    now: stashTree.lastLogin
  }

  return await serverLogin(ai, stashTree, stash, opts, request, async () => {
    return login.loginKey
  })
}

/**
 * Sets up a login v2 server authorization JSON.
 */
export function makeAuthJson(
  stashTree: LoginStash,
  login: LoginTree
): LoginRequestBody {
  const stash = searchTree(stashTree, stash => stash.appId === login.appId)
  const { syncToken, voucherAuth, voucherId } = stash ?? {
    syncToken: undefined,
    voucherAuth: undefined,
    voucherId: undefined
  }

  const { loginId, userId, loginAuth, passwordAuth } = login
  if (loginAuth != null) {
    return {
      loginId,
      loginAuth,
      otp: getLoginOtp(login),
      syncToken,
      voucherAuth,
      voucherId
    }
  }
  if (passwordAuth != null && userId != null) {
    return {
      userId,
      passwordAuth,
      otp: getLoginOtp(login),
      syncToken,
      voucherAuth,
      voucherId
    }
  }
  throw new Error('No server authentication methods available')
}

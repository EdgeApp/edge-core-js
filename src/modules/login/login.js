/**
 * Functions for working with login data in its on-disk format.
 */

// @flow
import type { AbcLoginMessages } from 'airbitz-core-types'

import { decrypt } from '../../util/crypto/crypto.js'
import { totp } from '../../util/crypto/hotp.js'
import { base64, utf8 } from '../../util/encoding.js'
import { elvis, filterObject, softCat } from '../../util/util.js'
import type { ApiInput } from '../root.js'
import { authRequest } from './authServer.js'
import {
  fixWalletInfo,
  makeAccountType,
  makeKeyInfo,
  mergeKeyInfos
} from './keys.js'
import type {
  LoginKit,
  LoginReply,
  LoginStash,
  LoginTree
} from './login-types.js'
import { hashUsername } from './loginStore.js'

function cloneNode (node, children) {
  return { ...node, children }
}

/**
 * Returns the login that satisifies the given predicate,
 * or undefined if nothing matches.
 */
export function searchTree (node: any, predicate: any => boolean) {
  if (predicate(node)) return node

  if (node.children != null) {
    for (const child of node.children) {
      const out = searchTree(child, predicate)
      if (out != null) return out
    }
  }
}

/**
 * Replaces a node within a tree.
 * The `clone` callback is called for each unmodified node.
 * The `predicate` callback is used to find the target node.
 * The `update` callback is called on the target.
 */
function updateTree (node, predicate, update, clone = cloneNode) {
  if (predicate(node)) return update(node)

  const children =
    node.children != null
      ? node.children.map(child => updateTree(child, predicate, update, clone))
      : []

  return clone(node, children)
}

function applyLoginReplyInner (stash, loginKey, loginReply) {
  // Copy common items:
  const out = filterObject(loginReply, [
    'appId',
    'loginId',
    'loginAuthBox',
    'userId',
    'otpResetDate',
    'otpTimeout',
    'parentBox',
    'passwordAuthBox',
    'passwordBox',
    'passwordKeySnrp',
    'mnemonicBox',
    'rootKeyBox',
    'mnemonicBox',
    'syncKeyBox'
  ])

  // Preserve client-only data:
  out.username = stash.username
  out.userId = stash.userId
  out.otpKey = stash.otpKey

  // Store the pin key unencrypted:
  if (loginReply.pin2KeyBox != null) {
    const pin2Key = decrypt(loginReply.pin2KeyBox, loginKey)
    out.pin2Key = base64.stringify(pin2Key)
  }

  // Store the recovery key unencrypted:
  if (loginReply.recovery2KeyBox != null) {
    const recovery2Key = decrypt(loginReply.recovery2KeyBox, loginKey)
    out.recovery2Key = base64.stringify(recovery2Key)
  }

  // Keys (we could be more picky about this):
  out.keyBoxes = elvis(loginReply.keyBoxes, [])

  // Recurse into children:
  const stashChildren = elvis(stash.children, [])
  const replyChildren = elvis(loginReply.children, [])
  if (stashChildren.length > replyChildren.length) {
    throw new Error('The server has lost children!')
  }
  out.children = replyChildren.map((child, index) => {
    const childStash = stashChildren[index] != null ? stashChildren[index] : {}
    const childKey = decrypt(child.parentBox, loginKey)
    return applyLoginReplyInner(childStash, childKey, child)
  })

  return out
}

/**
 * Updates the given login stash object with fields from the auth server.
 * TODO: We don't trust the auth server 100%, so be picky about what we copy.
 */
export function applyLoginReply (
  stashTree: LoginStash,
  loginKey: Uint8Array,
  loginReply: LoginReply
): LoginStash {
  return updateTree(
    stashTree,
    stash => stash.appId === loginReply.appId,
    stash => applyLoginReplyInner(stash, loginKey, loginReply)
  )
}

function makeLoginTreeInner (stash, loginKey) {
  const login = {}

  if (stash.username != null) {
    login.username = stash.username
  }

  // Identity:
  if (stash.appId == null) {
    throw new Error('No appId provided')
  }
  if (stash.loginAuthBox != null) {
    login.loginAuth = decrypt(stash.loginAuthBox, loginKey)
  }
  if (stash.loginId == null) {
    throw new Error('No loginId provided')
  }
  login.appId = stash.appId
  login.loginId = stash.loginId
  login.loginKey = loginKey
  login.otpKey = stash.otpKey
  login.otpResetDate = stash.otpResetDate
  login.otpTimeout = stash.otpTimeout

  // Password:
  if (stash.userId != null) {
    login.userId = stash.userId
  } else if (stash.passwordAuthBox != null) {
    login.userId = login.loginId
  }
  if (stash.passwordAuthBox != null) {
    login.passwordAuth = decrypt(stash.passwordAuthBox, loginKey)
  }

  // PIN v2:
  if (stash.pin2Key != null) {
    login.pin2Key = base64.parse(stash.pin2Key)
  }

  // Recovery v2:
  if (stash.recovery2Key != null) {
    login.recovery2Key = base64.parse(stash.recovery2Key)
  }

  const legacyKeys = []

  // BitID wallet:
  if (stash.menemonicBox != null && stash.rootKeyBox != null) {
    const mnemonic = utf8.stringify(decrypt(stash.menemonicBox, loginKey))
    const rootKey = decrypt(stash.rootKeyBox, loginKey)
    const keys = {
      mnemonic,
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
  const keyInfos = elvis(stash.keyBoxes, []).map(box =>
    JSON.parse(utf8.stringify(decrypt(box, loginKey)))
  )

  login.keyInfos = mergeKeyInfos([...legacyKeys, ...keyInfos]).map(walletInfo =>
    fixWalletInfo(walletInfo)
  )

  // Recurse into children:
  login.children = elvis(stash.children, []).map(child => {
    const childKey = decrypt(child.parentBox, loginKey)
    return makeLoginTreeInner(child, childKey)
  })

  // Integrity check:
  if (login.loginAuth == null && login.passwordAuth == null) {
    throw new Error('No server authentication methods on login')
  }

  return login
}

/**
 * Converts a login stash into an in-memory login object.
 */
export function makeLoginTree (
  stashTree: LoginStash,
  loginKey: Uint8Array,
  appId: string = ''
) {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => makeLoginTreeInner(stash, loginKey),
    (stash, children) => {
      const login = filterObject(stash, ['username', 'appId', 'loginId'])
      login.children = children
      return login
    }
  )
}

/**
 * Prepares a login stash for edge login,
 * stripping out any information that the target app is not allowed to see.
 */
export function sanitizeLoginStash (stashTree: LoginStash, appId: string) {
  return updateTree(
    stashTree,
    stash => stash.appId === appId,
    stash => stash,
    (stash, children) => {
      const login = filterObject(stash, ['username', 'appId', 'loginId'])
      login.children = children
      return login
    }
  )
}

/**
 * Changing a login involves updating the server, the in-memory login,
 * and the on-disk stash. A login kit contains all three elements,
 * and this function knows how to apply them all.
 */
export function applyKit (ai: ApiInput, loginTree: LoginTree, kit: LoginKit) {
  const { loginStore } = ai.props
  const { loginId, serverMethod = 'POST', serverPath } = kit
  const login = searchTree(loginTree, login => login.loginId === loginId)
  if (!login) throw new Error('Cannot apply kit: missing login')

  return loginStore.load(loginTree.username).then(stashTree => {
    const request: Object = makeAuthJson(login)
    request.data = kit.server
    return authRequest(ai, serverMethod, serverPath, request).then(reply => {
      const newLoginTree = updateTree(
        loginTree,
        login => login.loginId === loginId,
        login => ({
          ...login,
          ...kit.login,
          children: softCat(login.children, kit.login.children),
          keyInfos: mergeKeyInfos(softCat(login.keyInfos, kit.login.keyInfos))
        })
      )

      const newStashTree = updateTree(
        stashTree,
        stash => stash.loginId === loginId,
        stash => ({
          ...stash,
          ...kit.stash,
          children: softCat(stash.children, kit.stash.children),
          keyBoxes: softCat(stash.keyBoxes, kit.stash.keyBoxes)
        })
      )

      return loginStore.save(newStashTree).then(() => newLoginTree)
    })
  })
}

/**
 * Refreshes a login with data from the server.
 */
export function syncLogin (
  ai: ApiInput,
  loginTree: LoginTree,
  login: LoginTree
) {
  const { loginStore } = ai.props
  return loginStore.load(loginTree.username).then(stashTree => {
    const request = makeAuthJson(login)
    return authRequest(ai, 'POST', '/v2/login', request).then(reply => {
      const newStashTree = applyLoginReply(stashTree, login.loginKey, reply)
      const newLoginTree = makeLoginTree(stashTree, login.loginKey, login.appId)

      return loginStore.save(newStashTree).then(() => newLoginTree)
    })
  })
}

/**
 * Sets up a login v2 server authorization JSON.
 */
export function makeAuthJson (login: LoginTree) {
  if (login.loginAuth != null) {
    return {
      loginId: login.loginId,
      loginAuth: base64.stringify(login.loginAuth),
      otp: totp(login.otpKey)
    }
  }
  if (login.passwordAuth != null) {
    return {
      userId: login.userId,
      passwordAuth: base64.stringify(login.passwordAuth),
      otp: totp(login.otpKey)
    }
  }
  throw new Error('No server authentication methods available')
}

/**
 * Requests an OTP reset.
 */
export async function resetOtp (
  ai: ApiInput,
  username: string,
  resetToken: string
): Promise<Date> {
  const request = {
    userId: base64.stringify(await hashUsername(ai, username)),
    otpResetAuth: resetToken
  }
  return authRequest(ai, 'DELETE', '/v2/login/otp', request).then(reply => {
    // The server returns dates as ISO 8601 formatted strings:
    return new Date(reply.otpResetDate)
  })
}

/**
 * Fetches any login-related messages for all the users on this device.
 */
export function fetchLoginMessages (ai: ApiInput): Promise<AbcLoginMessages> {
  const { loginStore } = ai.props
  return loginStore.mapLoginIds().then(loginMap => {
    const request = {
      loginIds: Object.keys(loginMap)
    }
    return authRequest(ai, 'POST', '/v2/messages', request).then(reply => {
      const out = {}
      for (const message of reply) {
        const username = loginMap[message.loginId]
        if (username) out[username] = message
      }
      return out
    })
  })
}

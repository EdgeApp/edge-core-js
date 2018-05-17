// @flow

import { decrypt, encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { fixOtpKey, totp } from '../../util/crypto/hotp.js'
import { base64, utf8 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { authRequest } from './authServer.js'
import type { LoginKit, LoginStash, LoginTree } from './login-types.js'
import { applyLoginReply, makeLoginTree, searchTree } from './login.js'
import { fixUsername } from './loginStore.js'

function pin2Id (pin2Key: Uint8Array, username: string) {
  const data = utf8.parse(fixUsername(username))
  return hmacSha256(data, pin2Key)
}

function pin2Auth (pin2Key, pin) {
  return hmacSha256(utf8.parse(pin), pin2Key)
}

/**
 * Fetches and decrypts the loginKey from the server.
 * @return Promise<{loginKey, loginReply}>
 */
async function fetchLoginKey (
  ai: ApiInput,
  pin2Key: Uint8Array,
  username: string,
  pin: string,
  otp: string | void
) {
  const request = {
    pin2Id: base64.stringify(pin2Id(pin2Key, username)),
    pin2Auth: base64.stringify(pin2Auth(pin2Key, pin)),
    otp
  }
  const reply = await authRequest(ai, 'POST', '/v2/login', request)
  if (reply.pin2Box == null) {
    throw new Error('Missing data for PIN v2 login')
  }
  return {
    loginKey: decrypt(reply.pin2Box, pin2Key),
    loginReply: reply
  }
}

/**
 * Returns a copy of the PIN login key if one exists on the local device.
 */
export function getPin2Key (stashTree: LoginStash, appId: string) {
  const stash =
    stashTree.pin2Key != null
      ? stashTree
      : searchTree(stashTree, stash => stash.appId === appId)
  return stash != null && stash.pin2Key != null
    ? { pin2Key: base64.parse(stash.pin2Key), appId: stash.appId }
    : { pin2Key: void 0, appId: void 0 }
}

/**
 * Logs a user in using their PIN.
 * @return A `Promise` for the new root login.
 */
export async function loginPin2 (
  ai: ApiInput,
  appId: string,
  username: string,
  pin: string,
  otpKey: string | void
) {
  const { loginStore } = ai.props
  let stashTree = await loginStore.load(username)
  const { pin2Key, appId: appIdFound } = getPin2Key(stashTree, appId)
  if (pin2Key == null) {
    throw new Error('No PIN set locally for this account')
  }
  const { loginKey, loginReply } = await fetchLoginKey(
    ai,
    pin2Key,
    username,
    pin,
    totp(otpKey || stashTree.otpKey)
  )
  stashTree = applyLoginReply(stashTree, loginKey, loginReply)
  if (otpKey) stashTree.otpKey = fixOtpKey(otpKey)
  loginStore.save(stashTree)

  // Capture the PIN into the login tree:
  const loginTree = makeLoginTree(stashTree, loginKey, appIdFound)
  if (loginTree.pin == null) loginTree.pin = pin
  return loginTree
}

/**
 * Returns true if the given pin is correct.
 */
export async function checkPin2 (ai: ApiInput, login: LoginTree, pin: string) {
  const { appId, username } = login
  const { loginStore } = ai.props
  const stashTree = await loginStore.load(username)
  const { pin2Key } = getPin2Key(stashTree, appId)
  if (pin2Key == null) {
    throw new Error('No PIN set locally for this account')
  }
  return fetchLoginKey(ai, pin2Key, username, pin, totp(stashTree.otpKey)).then(
    good => true,
    bad => false
  )
}

/**
 * Creates the data needed to attach a PIN to a tree of logins.
 */
export function makeChangePin2Kits (
  ai: ApiInput,
  loginTree: LoginTree,
  username: string,
  pin: string,
  enableLogin: boolean
): Array<LoginKit> {
  const out: Array<LoginKit> = [
    makeChangePin2Kit(ai, loginTree, username, pin, enableLogin)
  ]

  if (loginTree.children) {
    for (const child of loginTree.children) {
      out.push(...makeChangePin2Kits(ai, child, username, pin, enableLogin))
    }
  }

  return out
}

/**
 * Creates the data needed to attach a PIN to a login.
 */
export function makeChangePin2Kit (
  ai: ApiInput,
  login: LoginTree,
  username: string,
  pin: string,
  enableLogin: boolean
) {
  const { io } = ai.props
  const pin2TextBox = encrypt(io, utf8.parse(pin), login.loginKey)

  if (enableLogin) {
    const pin2Key = login.pin2Key || io.random(32)
    const pin2Box = encrypt(io, login.loginKey, pin2Key)
    const pin2KeyBox = encrypt(io, pin2Key, login.loginKey)

    return {
      serverPath: '/v2/login/pin2',
      server: {
        pin2Id: base64.stringify(pin2Id(pin2Key, username)),
        pin2Auth: base64.stringify(pin2Auth(pin2Key, pin)),
        pin2Box,
        pin2KeyBox,
        pin2TextBox
      },
      stash: {
        pin2Key: base64.stringify(pin2Key),
        pin2TextBox
      },
      login: {
        pin2Key,
        pin
      },
      loginId: login.loginId
    }
  } else {
    return {
      serverPath: '/v2/login/pin2',
      server: {
        pin2TextBox
      },
      stash: {
        pin2Key: void 0,
        pin2TextBox
      },
      login: {
        pin2Key: void 0,
        pin
      },
      loginId: login.loginId
    }
  }
}

/**
 * Creates the data needed to delete a PIN from a tree of logins.
 */
export function makeDeletePin2Kits (loginTree: LoginTree): Array<LoginKit> {
  const out: Array<LoginKit> = [makeDeletePin2Kit(loginTree)]

  if (loginTree.children) {
    for (const child of loginTree.children) {
      out.push(...makeDeletePin2Kits(child))
    }
  }

  return out
}

/**
 * Creates the data needed to delete a PIN from a login.
 */
export function makeDeletePin2Kit (login: LoginTree): LoginKit {
  // Flow complains about these fields being `undefined`:
  const out: any = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/pin2',
    server: void 0,
    stash: {
      pin2Key: void 0
    },
    login: {
      pin2Key: void 0
    },
    loginId: login.loginId
  }
  return out
}

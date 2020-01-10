// @flow

import { base64 } from 'rfc4648'

import { decrypt, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256 } from '../../util/crypto/hashes.js'
import { fixOtpKey, totp } from '../../util/crypto/hotp.js'
import { utf8 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { loginFetch } from './login-fetch.js'
import { fixUsername, getStash } from './login-selectors.js'
import {
  type LoginKit,
  type LoginStash,
  type LoginTree
} from './login-types.js'
import {
  applyKits,
  applyLoginReply,
  makeLoginTree,
  searchTree
} from './login.js'
import { saveStash } from './loginStore.js'

function pin2Id(pin2Key: Uint8Array, username: string) {
  const data = utf8.parse(fixUsername(username))
  return hmacSha256(data, pin2Key)
}

function pin2Auth(pin2Key, pin) {
  return hmacSha256(utf8.parse(pin), pin2Key)
}

/**
 * Fetches and decrypts the loginKey from the server.
 * @return Promise<{loginKey, loginReply}>
 */
async function fetchLoginKey(
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
  const reply = await loginFetch(ai, 'POST', '/v2/login', request)
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
export function getPin2Key(stashTree: LoginStash, appId: string) {
  const stash =
    stashTree.pin2Key != null
      ? stashTree
      : searchTree(stashTree, stash => stash.appId === appId)
  return stash != null && stash.pin2Key != null
    ? { pin2Key: base64.parse(stash.pin2Key), appId: stash.appId }
    : { pin2Key: undefined, appId: undefined }
}

/**
 * Logs a user in using their PIN.
 * @return A `Promise` for the new root login.
 */
export async function loginPin2(
  ai: ApiInput,
  appId: string,
  username: string,
  pin: string,
  otpKey: string | void
) {
  let stashTree = getStash(ai, username)
  const { pin2Key, appId: appIdFound } = getPin2Key(stashTree, appId)
  if (pin2Key == null) {
    throw new Error('PIN login is not enabled for this account on this device')
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
  await saveStash(ai, stashTree)

  // Capture the PIN into the login tree:
  return makeLoginTree(stashTree, loginKey, appIdFound)
}

export async function changePin(
  ai: ApiInput,
  accountId: string,
  pin: string | void,
  enableLogin: boolean | void
) {
  const { loginTree, username } = ai.props.state.accounts[accountId]

  // Figure out defaults:
  if (enableLogin == null) {
    enableLogin =
      loginTree.pin2Key != null || (pin != null && loginTree.pin == null)
  }
  if (pin == null) pin = loginTree.pin

  // We cannot enable PIN login if we don't know the PIN:
  if (pin == null) {
    if (!enableLogin) {
      // But we can disable PIN login by just deleting it entirely:
      return applyKits(ai, loginTree, makeDeletePin2Kits(loginTree))
    }
    throw new Error(
      'Please change your PIN in the settings area above before enabling.'
    )
  }

  const kits = makeChangePin2Kits(ai, loginTree, username, pin, enableLogin)
  await applyKits(ai, loginTree, kits)
}

/**
 * Returns true if the given pin is correct.
 */
export async function checkPin2(ai: ApiInput, login: LoginTree, pin: string) {
  const { appId, username } = login
  if (!username) return false

  const stashTree = getStash(ai, username)
  const { pin2Key } = getPin2Key(stashTree, appId)
  if (pin2Key == null) {
    throw new Error('No PIN set locally for this account')
  }
  return fetchLoginKey(ai, pin2Key, username, pin, totp(stashTree.otpKey)).then(
    good => true,
    bad => false
  )
}

export async function deletePin(ai: ApiInput, accountId: string) {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kits = makeDeletePin2Kits(loginTree)
  await applyKits(ai, loginTree, kits)
}

/**
 * Creates the data needed to attach a PIN to a tree of logins.
 */
export function makeChangePin2Kits(
  ai: ApiInput,
  loginTree: LoginTree,
  username: string,
  pin: string,
  enableLogin: boolean
): LoginKit[] {
  const out: LoginKit[] = [
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
export function makeChangePin2Kit(
  ai: ApiInput,
  login: LoginTree,
  username: string,
  pin: string,
  enableLogin: boolean
): LoginKit {
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
        pin2Key: undefined,
        pin2TextBox
      },
      login: {
        pin2Key: undefined,
        pin
      },
      loginId: login.loginId
    }
  }
}

/**
 * Creates the data needed to delete a PIN from a tree of logins.
 */
export function makeDeletePin2Kits(loginTree: LoginTree): LoginKit[] {
  const out: LoginKit[] = [makeDeletePin2Kit(loginTree)]

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
export function makeDeletePin2Kit(login: LoginTree): LoginKit {
  // Flow complains about these fields being `undefined`:
  const out: any = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/pin2',
    server: undefined,
    stash: {
      pin2Key: undefined
    },
    login: {
      pin2Key: undefined
    },
    loginId: login.loginId
  }
  return out
}

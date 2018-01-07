// @flow
import { decrypt, encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { totp } from '../../util/crypto/hotp.js'
import { base64, utf8 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { authRequest } from './authServer.js'
import type { LoginStash, LoginTree } from './login-types.js'
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
  if (otpKey) stashTree.otpKey = otpKey
  loginStore.save(stashTree)
  return makeLoginTree(stashTree, loginKey, appIdFound)
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
 * Creates the data needed to attach a PIN to a login.
 */
export function makePin2Kit (
  ai: ApiInput,
  login: LoginTree,
  username: string,
  pin: string
) {
  const { io } = ai.props
  const pin2Key = login.pin2Key || io.random(32)
  const pin2Box = encrypt(io, login.loginKey, pin2Key)
  const pin2KeyBox = encrypt(io, pin2Key, login.loginKey)

  return {
    serverPath: '/v2/login/pin2',
    server: {
      pin2Id: base64.stringify(pin2Id(pin2Key, username)),
      pin2Auth: base64.stringify(pin2Auth(pin2Key, pin)),
      pin2Box,
      pin2KeyBox
    },
    stash: {
      pin2Key: base64.stringify(pin2Key)
    },
    login: {
      pin,
      pin2Key
    },
    loginId: login.loginId
  }
}

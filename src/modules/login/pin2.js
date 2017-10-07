// @flow
import { decrypt, encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { authRequest } from './authServer.js'
import type { LoginStash, LoginTree } from './login-types.js'
import { applyLoginReply, makeLoginTree, searchTree } from './login.js'
import { fixUsername } from './loginStore.js'

function pin2Id (pin2Key: Uint8Array, username: string) {
  return hmacSha256(fixUsername(username), pin2Key)
}

function pin2Auth (pin2Key, pin) {
  return hmacSha256(pin, pin2Key)
}

/**
 * Fetches and decrypts the loginKey from the server.
 * @return Promise<{loginKey, loginReply}>
 */
function fetchLoginKey (
  ai: ApiInput,
  pin2Key: Uint8Array,
  username: string,
  pin: string
) {
  const request = {
    pin2Id: base64.stringify(pin2Id(pin2Key, username)),
    pin2Auth: base64.stringify(pin2Auth(pin2Key, pin))
    // "otp": null
  }
  return authRequest(ai, 'POST', '/v2/login', request).then(reply => {
    if (reply.pin2Box == null) {
      throw new Error('Missing data for PIN v2 login')
    }
    return {
      loginKey: decrypt(reply.pin2Box, pin2Key),
      loginReply: reply
    }
  })
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
export function loginPin2 (
  ai: ApiInput,
  appId: string,
  username: string,
  pin: string
) {
  const { loginStore } = ai.props
  return loginStore.load(username).then(stashTree => {
    const { pin2Key, appId: appIdFound } = getPin2Key(stashTree, appId)
    if (pin2Key == null) {
      throw new Error('No PIN set locally for this account')
    }
    return fetchLoginKey(ai, pin2Key, username, pin).then(values => {
      const { loginKey, loginReply } = values
      stashTree = applyLoginReply(stashTree, loginKey, loginReply)
      loginStore.save(stashTree)
      return makeLoginTree(stashTree, loginKey, appIdFound)
    })
  })
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

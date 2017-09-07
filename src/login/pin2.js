import { fixUsername } from '../io/loginStore.js'
import { decrypt, encrypt, hmacSha256 } from '../util/crypto/crypto.js'
import { base64 } from '../util/encoding.js'
import { applyLoginReply, makeLoginTree, searchTree } from './login.js'

function pin2Id (pin2Key, username) {
  return hmacSha256(fixUsername(username), pin2Key)
}

function pin2Auth (pin2Key, pin) {
  return hmacSha256(pin, pin2Key)
}

/**
 * Fetches and decrypts the loginKey from the server.
 * @return Promise<{loginKey, loginReply}>
 */
function fetchLoginKey (io, pin2Key, username, pin) {
  const request = {
    pin2Id: base64.stringify(pin2Id(pin2Key, username)),
    pin2Auth: base64.stringify(pin2Auth(pin2Key, pin))
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
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
export function getPin2Key (stashTree, appId) {
  const stash =
    stashTree.pin2Key != null
      ? stashTree
      : searchTree(stashTree, stash => stash.appId === appId)
  return stash != null && stash.pin2Key != null
    ? { pin2Key: base64.parse(stash.pin2Key), appId: stash.appId }
    : {}
}

/**
 * Logs a user in using their PIN.
 * @return A `Promise` for the new root login.
 */
export function loginPin2 (io, appId, username, pin) {
  return io.loginStore.load(username).then(stashTree => {
    const { pin2Key, appId: appIdFound } = getPin2Key(stashTree, appId)
    if (pin2Key == null) {
      throw new Error('No PIN set locally for this account')
    }
    return fetchLoginKey(io, pin2Key, username, pin).then(values => {
      const { loginKey, loginReply } = values
      stashTree = applyLoginReply(stashTree, loginKey, loginReply)
      io.loginStore.save(stashTree)
      return makeLoginTree(stashTree, loginKey, appIdFound)
    })
  })
}

/**
 * Creates the data needed to attach a PIN to a login.
 */
export function makePin2Kit (io, login, username, pin) {
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

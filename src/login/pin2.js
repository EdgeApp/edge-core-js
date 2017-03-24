import { decrypt, encrypt, hmacSha256 } from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import { base64 } from '../util/encoding.js'
import { objectAssign } from '../util/util.js'
import { applyLoginReply, makeAuthJson, makeLogin, searchTree } from './login.js'

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
export function getPin2Key (loginStash, appId) {
  const stash = loginStash.pin2Key != null
    ? loginStash
    : searchTree(loginStash, stash => stash.appId === appId)
  return stash != null && stash.pin2Key != null
    ? { pin2Key: base64.parse(stash.pin2Key), appId: stash.appId }
    : {}
}

/**
 * Logs a user in using their PIN.
 * @return A `Promise` for the new root login.
 */
export function loginPin2 (io, appId, username, pin) {
  return io.loginStore.load(username).then(loginStash => {
    const { pin2Key, appIdFound } = getPin2Key(loginStash, appId)
    if (pin2Key == null) {
      throw new Error('No PIN set locally for this account')
    }
    return fetchLoginKey(io, pin2Key, username, pin).then(values => {
      const { loginKey, loginReply } = values
      loginStash = applyLoginReply(loginStash, loginKey, loginReply)
      io.loginStore.save(loginStash)
      return makeLogin(loginStash, loginKey, appIdFound)
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
    }
  }
}

/**
 * Sets up PIN login v2.
 */
export function setupPin2 (io, rootLogin, login, pin) {
  const kit = makePin2Kit(io, login, rootLogin.username, pin)

  const request = makeAuthJson(login)
  request.data = kit.server
  return io.authRequest('POST', '/v2/login/pin2', request).then(reply => {
    login.pin2Key = kit.login.pin2Key
    return io.loginStore
      .update(rootLogin, login, stash => objectAssign(stash, kit.stash))
      .then(() => login)
  })
}

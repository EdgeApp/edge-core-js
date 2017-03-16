import * as crypto from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import {base58, base64} from '../util/encoding.js'
import { applyLoginReply, makeAuthJson, makeLogin } from './login.js'

function pin2Id (pin2Key, username) {
  return crypto.hmacSha256(fixUsername(username), pin2Key)
}

function pin2Auth (pin2Key, pin) {
  return crypto.hmacSha256(pin, pin2Key)
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
      loginKey: crypto.decrypt(reply.pin2Box, pin2Key),
      loginReply: reply
    }
  })
}

/**
 * Returns a copy of the PIN login key if one exists on the local device.
 */
export function getKey (loginStash) {
  if (loginStash.pin2Key != null) {
    return base58.parse(loginStash.pin2Key)
  }
}

/**
 * Logs a user in using their PIN.
 */
export function login (io, username, pin) {
  return io.loginStore.load(username).then(loginStash => {
    const pin2Key = getKey(loginStash)
    if (pin2Key == null) {
      throw new Error('No PIN set locally for this account')
    }
    return fetchLoginKey(io, pin2Key, username, pin).then(values => {
      const { loginKey, loginReply } = values
      loginStash = applyLoginReply(loginStash, loginKey, loginReply)
      io.loginStore.save(loginStash)
      return makeLogin(loginStash, loginKey)
    })
  })
}

/**
 * Creates the data needed to attach a PIN to a login.
 */
export function makePin2Kit (io, login, username, pin) {
  const pin2Key = login.pin2Key || io.random(32)
  const pin2Box = crypto.encrypt(io, login.loginKey, pin2Key)
  const pin2KeyBox = crypto.encrypt(io, pin2Key, login.loginKey)

  return {
    server: {
      pin2Id: base64.stringify(pin2Id(pin2Key, username)),
      pin2Auth: base64.stringify(pin2Auth(pin2Key, pin)),
      pin2Box,
      pin2KeyBox
    },
    stash: {
      pin2Key: base58.stringify(pin2Key)
    },
    login: {
      pin2Key
    }
  }
}

/**
 * Sets up PIN login v2.
 */
export function setup (io, login, pin) {
  const kit = makePin2Kit(io, login, login.username, pin)

  const request = makeAuthJson(login)
  request.data = kit.server
  return io.authRequest('POST', '/v2/login/pin2', request).then(reply => {
    io.loginStore.update(login.userId, kit.stash)
    login.pin2Key = kit.login.pin2Key
    return login
  })
}

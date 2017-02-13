import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {base58, base64} from '../util/encoding.js'
import {Login} from './login.js'

function pin2Id (pin2Key, username) {
  return crypto.hmacSha256(username, pin2Key)
}

function pin2Auth (pin2Key, pin) {
  return crypto.hmacSha256(pin, pin2Key)
}

/**
 * Returns a copy of the PIN login key if one exists on the local device.
 */
export function getKey (io, username) {
  const fixedName = userMap.normalize(username)
  const userStorage = new UserStorage(io.localStorage, fixedName)
  return userStorage.getItem('pin2Key')
}

/**
 * Logs a user in using their PIN.
 * @param username string
 * @param pin2Key the recovery key, as a base58 string.
 * @param pin the PIN, as a string.
 * @param `Login` object promise
 */
export function login (io, pin2Key, username, pin) {
  pin2Key = base58.parse(pin2Key)
  username = userMap.normalize(username)

  const request = {
    'pin2Id': base64.stringify(pin2Id(pin2Key, username)),
    'pin2Auth': base64.stringify(pin2Auth(pin2Key, pin))
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // PIN login:
    const pin2Box = reply['pin2Box']
    if (!pin2Box) {
      throw new Error('Missing data for PIN v2 login')
    }

    // Decrypt the dataKey:
    const dataKey = crypto.decrypt(pin2Box, pin2Key)

    // Build the login object:
    return userMap.getUserId(io, username).then(userId => {
      return Login.online(io, username, userId, dataKey, reply)
    })
  })
}

/**
 * Creates the data needed to set up a PIN on the account.
 */
export function makeSetup (io, login, pin) {
  const pin2Key = login.pin2Key || io.random(32)

  const pin2Box = crypto.encrypt(io, login.dataKey, pin2Key)
  const pin2KeyBox = crypto.encrypt(io, pin2Key, login.dataKey)

  return {
    server: {
      'pin2Id': base64.stringify(pin2Id(pin2Key, login.username)),
      'pin2Auth': base64.stringify(pin2Auth(pin2Key, pin)),
      'pin2Box': pin2Box,
      'pin2KeyBox': pin2KeyBox
    },
    storage: {
      'pin2Key': base58.stringify(pin2Key)
    },
    pin2Key
  }
}

/**
 * Sets up PIN login v2.
 */
export function setup (io, login, pin) {
  const setup = makeSetup(io, login, pin)

  const request = login.authJson()
  request['data'] = setup.server
  return io.authRequest('POST', '/v2/login/pin2', request).then(reply => {
    login.userStorage.setItems(setup.storage)
    return base58.stringify(setup.pin2Key)
  })
}

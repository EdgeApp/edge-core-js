import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {base58} from '../util/encoding.js'
import {Login} from './login.js'

function pin2Id (pin2Key, username) {
  return new Buffer(crypto.hmacSha256(username, pin2Key))
}

function pin2Auth (pin2Key, pin) {
  return new Buffer(crypto.hmacSha256(pin, pin2Key))
}

/**
 * Returns true if the local device has a copy of the PIN login key.
 */
export function getKey (io, username) {
  username = userMap.normalize(username)

  // Extract stuff from storage:
  const userStorage = new UserStorage(io.localStorage, username)
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
  pin2Key = base58.decode(pin2Key)
  username = userMap.normalize(username)

  const request = {
    'pin2Id': pin2Id(pin2Key, username).toString('base64'),
    'pin2Auth': pin2Auth(pin2Key, pin).toString('base64')
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
    return userMap.getUserId(io.localStorage, username).then(userId => {
      return Login.online(io.localStorage, username, userId, dataKey, reply)
    })
  })
}

/**
 * Creates the data needed to set up a PIN on the account.
 */
export function makeSetup (io, login, pin) {
  let pin2Key = login.userStorage.getItem('pin2Key')
  if (pin2Key) {
    pin2Key = base58.decode(pin2Key)
  } else {
    pin2Key = crypto.random(32)
  }

  const pin2Box = crypto.encrypt(login.dataKey, pin2Key)
  const pin2KeyBox = crypto.encrypt(pin2Key, login.dataKey)

  return {
    server: {
      'pin2Id': pin2Id(pin2Key, login.username).toString('base64'),
      'pin2Auth': pin2Auth(pin2Key, pin).toString('base64'),
      'pin2Box': pin2Box,
      'pin2KeyBox': pin2KeyBox
    },
    storage: {
      'pin2Key': base58.encode(pin2Key)
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
  return io.authRequest('PUT', '/v2/login/pin2', request).then(reply => {
    login.userStorage.setItems(setup.storage)
    return base58.encode(setup.pin2Key)
  })
}

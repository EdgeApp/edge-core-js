import * as crypto from '../crypto/crypto.js'
import * as scrypt from '../crypto/scrypt.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {rejectify} from '../util/decorators.js'
import * as promise from '../util/promise.js'
import {Login} from './login.js'

function loginOffline (io, username, userId, password) {
  // Extract stuff from storage:
  const userStorage = new UserStorage(io.localStorage, username)
  const passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  const passwordBox = userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Missing data for offline login')
  }

  // Decrypt the dataKey:
  return scrypt.scrypt(username + password, passwordKeySnrp).then(passwordKey => {
    const dataKey = crypto.decrypt(passwordBox, passwordKey)
    return Login.offline(io.localStorage, username, userId, dataKey)
  })
}

function loginOnline (io, username, userId, password) {
  return scrypt.scrypt(username + password, scrypt.passwordAuthSnrp).then(passwordAuth => {
    // Encode the username:
    const request = {
      'userId': userId,
      'passwordAuth': passwordAuth.toString('base64')
      // "otp": null
    }
    return io.authRequest('POST', '/v2/login', request).then(reply => {
      // Password login:
      const passwordKeySnrp = reply['passwordKeySnrp']
      const passwordBox = reply['passwordBox']
      if (!passwordKeySnrp || !passwordBox) {
        throw new Error('Missing data for password login')
      }

      // Decrypt the dataKey:
      return scrypt.scrypt(username + password, passwordKeySnrp).then(passwordKey => {
        const dataKey = crypto.decrypt(passwordBox, passwordKey)

        // Build the login object:
        return Login.online(io.localStorage, username, userId, dataKey, reply)
      })
    })
  })
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @return `Login` object promise
 */
export function login (io, username, password) {
  username = userMap.normalize(username)
  return userMap.getUserId(io.localStorage, username).then(userId => {
    // Race the two login methods, and let the fastest one win:
    return promise.any([
      rejectify(loginOffline)(io, username, userId, password),
      rejectify(loginOnline)(io, username, userId, password)
    ])
  })
}

/**
 * Returns true if the given password is correct.
 */
export function check (io, login, password) {
  // Derive passwordAuth:
  return scrypt.scrypt(login.username + password, scrypt.passwordAuthSnrp).then(passwordAuth => {
    // Compare what we derived with what we have:
    for (let i = 0; i < passwordAuth.length; ++i) {
      if (passwordAuth[i] !== login.passwordAuth[i]) {
        return false
      }
    }
    return true
  })
}

/**
 * Creates the data needed to set up the password on the server.
 */
export function makeSetup (io, dataKey, username, password) {
  const up = username + password

  // dataKey chain:
  const boxPromise = scrypt.makeSnrp().then(passwordKeySnrp => {
    return scrypt.scrypt(up, passwordKeySnrp).then(passwordKey => {
      const passwordBox = crypto.encrypt(dataKey, passwordKey)
      return {passwordKeySnrp, passwordBox}
    })
  })

  // authKey chain:
  const authPromise = scrypt.scrypt(up, scrypt.passwordAuthSnrp).then(passwordAuth => {
    const passwordAuthBox = crypto.encrypt(passwordAuth, dataKey)
    return {passwordAuth, passwordAuthBox}
  })

  return Promise.all([boxPromise, authPromise]).then(values => {
    const [
      {passwordKeySnrp, passwordBox},
      {passwordAuth, passwordAuthBox}
    ] = values
    return {
      server: {
        'passwordAuth': passwordAuth.toString('base64'),
        'passwordAuthSnrp': scrypt.passwordAuthSnrp, // TODO: Not needed
        'passwordKeySnrp': passwordKeySnrp,
        'passwordBox': passwordBox,
        'passwordAuthBox': passwordAuthBox
      },
      storage: {
        'passwordKeySnrp': passwordKeySnrp,
        'passwordBox': passwordBox,
        'passwordAuthBox': passwordAuthBox
      },
      passwordAuth
    }
  })
}

/**
 * Sets up a password for the login.
 */
export function setup (io, login, password) {
  return makeSetup(io, login.dataKey, login.username, password).then(setup => {
    const request = login.authJson()
    request['data'] = setup.server
    return io.authRequest('PUT', '/v2/login/password', request).then(reply => {
      login.userStorage.setItems(setup.storage)
      login.passwordAuth = setup.passwordAuth
      return null
    })
  })
}

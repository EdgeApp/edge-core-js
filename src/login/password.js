import * as crypto from '../crypto/crypto.js'
import * as scrypt from '../crypto/scrypt.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {rejectify} from '../util/decorators.js'
import * as promise from '../util/promise.js'
import {Login} from './login.js'

function loginOffline (ctx, username, userId, password) {
  // Extract stuff from storage:
  const userStorage = new UserStorage(ctx.localStorage, username)
  const passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  const passwordBox = userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Missing data for offline login')
  }

  // Decrypt the dataKey:
  const passwordKey = scrypt.scrypt(username + password, passwordKeySnrp)
  const dataKey = crypto.decrypt(passwordBox, passwordKey)

  return Promise.resolve(Login.offline(ctx.localStorage, username, userId, dataKey))
}

function loginOnline (ctx, username, userId, password) {
  const passwordAuth = scrypt.scrypt(username + password, scrypt.passwordAuthSnrp)

  // Encode the username:
  const request = {
    'userId': userId,
    'passwordAuth': passwordAuth.toString('base64')
    // "otp": null
  }
  return ctx.authRequest('POST', '/v2/login', request).then(reply => {
    // Password login:
    const passwordKeySnrp = reply['passwordKeySnrp']
    const passwordBox = reply['passwordBox']
    if (!passwordKeySnrp || !passwordBox) {
      throw new Error('Missing data for password login')
    }

    // Decrypt the dataKey:
    const passwordKey = scrypt.scrypt(username + password, passwordKeySnrp)
    const dataKey = crypto.decrypt(passwordBox, passwordKey)

    // Build the login object:
    return Login.online(ctx.localStorage, username, userId, dataKey, reply)
  })
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @return `Login` object promise
 */
export function login (ctx, username, password) {
  username = userMap.normalize(username)
  const userId = userMap.getUserId(ctx.localStorage, username)

  // Race the two login methods, and let the fastest one win:
  return promise.any([
    rejectify(loginOffline)(ctx, username, userId, password),
    rejectify(loginOnline)(ctx, username, userId, password)
  ])
}

/**
 * Returns true if the given password is correct.
 */
export function check (ctx, login, password) {
  // Derive passwordAuth:
  const passwordAuth = scrypt.scrypt(login.username + password, scrypt.passwordAuthSnrp)

  // Compare what we derived with what we have:
  for (let i = 0; i < passwordAuth.length; ++i) {
    if (passwordAuth[i] !== login.passwordAuth[i]) {
      return Promise.resolve(false)
    }
  }
  return Promise.resolve(true)
}

/**
 * Creates the data needed to set up the password on the server.
 */
export function makeSetup (ctx, dataKey, username, password) {
  const up = username + password

  // dataKey chain:
  const passwordKeySnrp = scrypt.makeSnrp()
  const passwordKey = scrypt.scrypt(up, passwordKeySnrp)
  const passwordBox = crypto.encrypt(dataKey, passwordKey)

  // authKey chain:
  const passwordAuth = scrypt.scrypt(up, scrypt.passwordAuthSnrp)
  const passwordAuthBox = crypto.encrypt(passwordAuth, dataKey)

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
}

/**
 * Sets up a password for the login.
 */
export function setup (ctx, login, password) {
  const setup = makeSetup(ctx, login.dataKey, login.username, password)

  const request = login.authJson()
  request['data'] = setup.server
  return ctx.authRequest('PUT', '/v2/login/password', request).then(reply => {
    login.userStorage.setItems(setup.storage)
    login.passwordAuth = setup.passwordAuth
    return null
  })
}

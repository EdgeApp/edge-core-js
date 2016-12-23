import * as crypto from '../crypto.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
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
  const passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
  const dataKey = crypto.decrypt(passwordBox, passwordKey)

  return Login.offline(ctx.localStorage, username, dataKey)
}

function loginOnline (ctx, username, userId, password) {
  const passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)

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
    const passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
    const dataKey = crypto.decrypt(passwordBox, passwordKey)

    // Cache everything for future logins:
    userMap.insert(ctx.localStorage, username, userId)

    return Login.online(ctx.localStorage, username, dataKey, reply)
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

  try {
    return Promise.resolve(loginOffline(ctx, username, userId, password))
  } catch (e) {
    return loginOnline(ctx, username, userId, password)
  }
}

/**
 * Returns true if the given password is correct.
 */
export function check (ctx, login, password) {
  // Derive passwordAuth:
  const passwordAuth = crypto.scrypt(login.username + password, crypto.passwordAuthSnrp)

  // Compare what we derived with what we have:
  for (let i = 0; i < passwordAuth.length; ++i) {
    if (passwordAuth[i] !== login.passwordAuth[i]) {
      return false
    }
  }
  return true
}

/**
 * Creates the data needed to set up the password on the server.
 */
export function makeSetup (ctx, dataKey, username, password) {
  const up = username + password

  // dataKey chain:
  const passwordKeySnrp = crypto.makeSnrp()
  const passwordKey = crypto.scrypt(up, passwordKeySnrp)
  const passwordBox = crypto.encrypt(dataKey, passwordKey)

  // authKey chain:
  const passwordAuth = crypto.scrypt(up, crypto.passwordAuthSnrp)
  const passwordAuthBox = crypto.encrypt(passwordAuth, dataKey)

  return {
    server: {
      'passwordAuth': passwordAuth.toString('base64'),
      'passwordAuthSnrp': crypto.passwordAuthSnrp, // TODO: Not needed
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

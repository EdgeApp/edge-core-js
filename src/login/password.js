import * as crypto from '../crypto.js'
import {Login} from './login.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'

function loginOffline (ctx, username, userId, password, callback) {
  // Extract stuff from storage:
  const userStorage = new UserStorage(ctx.localStorage, username)
  const passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  const passwordBox = userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    return callback(Error('Missing data for offline login'))
  }

  try {
    // Decrypt the dataKey:
    const passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
    var dataKey = crypto.decrypt(passwordBox, passwordKey)
  } catch (e) {
    return callback(e)
  }
  return callback(null, Login.offline(ctx.localStorage, username, dataKey))
}

function loginOnline (ctx, username, userId, password, callback) {
  const passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)

  // Encode the username:
  const request = {
    'userId': userId,
    'passwordAuth': passwordAuth.toString('base64')
    // "otp": null
  }
  ctx.authRequest('POST', '/v2/login', request, function (err, reply) {
    if (err) return callback(err)

    try {
      // Password login:
      const passwordKeySnrp = reply['passwordKeySnrp']
      const passwordBox = reply['passwordBox']
      if (!passwordKeySnrp || !passwordBox) {
        return callback(Error('Missing data for password login'))
      }

      // Decrypt the dataKey:
      const passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
      var dataKey = crypto.decrypt(passwordBox, passwordKey)

      // Cache everything for future logins:
      userMap.insert(ctx.localStorage, username, userId)
    } catch (e) {
      return callback(e)
    }
    return callback(null, Login.online(ctx.localStorage, username, dataKey, reply))
  })
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @param callback function (err, keys)
 */
export function login (ctx, username, password, callback) {
  username = userMap.normalize(username)
  const userId = userMap.getUserId(ctx.localStorage, username)

  loginOffline(ctx, username, userId, password, function (err, account) {
    if (!err) return callback(null, account)
    return loginOnline(ctx, username, userId, password, callback)
  })
}

/**
 * Returns true if the given password is correct.
 */
export function check (ctx, login, password) {
  // Extract stuff from storage:
  const passwordKeySnrp = login.userStorage.getJson('passwordKeySnrp')
  const passwordBox = login.userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Keys missing from local storage')
  }

  try {
    // Decrypt the dataKey:
    const passwordKey = crypto.scrypt(login.username + password, passwordKeySnrp)
    crypto.decrypt(passwordBox, passwordKey)
  } catch (e) {
    return false
  }
  return true
}

/**
 * Sets up a password for the login.
 */
export function setup (ctx, login, password, callback) {
  const up = login.username + password

  // Create new keys:
  const passwordAuth = crypto.scrypt(up, crypto.passwordAuthSnrp)
  const passwordKeySnrp = crypto.makeSnrp()
  const passwordKey = crypto.scrypt(up, passwordKeySnrp)

  // Encrypt:
  const passwordBox = crypto.encrypt(login.dataKey, passwordKey)
  const passwordAuthBox = crypto.encrypt(passwordAuth, login.dataKey)

  const request = login.authJson()
  request['data'] = {
    'passwordAuth': passwordAuth.toString('base64'),
    'passwordAuthSnrp': crypto.passwordAuthSnrp, // TODO: Not needed
    'passwordKeySnrp': passwordKeySnrp,
    'passwordBox': passwordBox,
    'passwordAuthBox': passwordAuthBox
  }
  ctx.authRequest('PUT', '/v2/login/password', request, function (err, reply) {
    if (err) return callback(err)

    login.userStorage.setJson('passwordKeySnrp', passwordKeySnrp)
    login.userStorage.setJson('passwordBox', passwordBox)
    login.userStorage.setJson('passwordAuthBox', passwordAuthBox)
    login.passwordAuth = passwordAuth

    return callback(null)
  })
}

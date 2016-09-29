import * as crypto from '../crypto.js'
import {Login} from './login.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'

function loginOffline (ctx, username, userId, password, callback) {
  // Extract stuff from storage:
  var userStorage = new UserStorage(ctx.localStorage, username)
  var passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  var passwordBox = userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    return callback(Error('Missing data for offline login'))
  }

  try {
    // Decrypt the dataKey:
    var passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
    var dataKey = crypto.decrypt(passwordBox, passwordKey)
  } catch (e) {
    return callback(e)
  }
  return callback(null, Login.offline(ctx.localStorage, username, dataKey))
}

function loginOnline (ctx, username, userId, password, callback) {
  var passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)

  // Encode the username:
  var request = {
    'userId': userId,
    'passwordAuth': passwordAuth.toString('base64')
    // "otp": null
  }
  ctx.authRequest('POST', '/v2/login', request, function (err, reply) {
    if (err) return callback(err)

    try {
      // Password login:
      var passwordKeySnrp = reply['passwordKeySnrp']
      var passwordBox = reply['passwordBox']
      if (!passwordKeySnrp || !passwordBox) {
        return callback(Error('Missing data for password login'))
      }

      // Decrypt the dataKey:
      var passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
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
  var userId = userMap.getUserId(ctx.localStorage, username)

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
  var passwordKeySnrp = login.userStorage.getJson('passwordKeySnrp')
  var passwordBox = login.userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Keys missing from local storage')
  }

  try {
    // Decrypt the dataKey:
    var passwordKey = crypto.scrypt(login.username + password, passwordKeySnrp)
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
  var up = login.username + password

  // Create new keys:
  var passwordAuth = crypto.scrypt(up, crypto.passwordAuthSnrp)
  var passwordKeySnrp = crypto.makeSnrp()
  var passwordKey = crypto.scrypt(up, passwordKeySnrp)

  // Encrypt:
  var passwordBox = crypto.encrypt(login.dataKey, passwordKey)
  var passwordAuthBox = crypto.encrypt(passwordAuth, login.dataKey)

  var request = login.authJson()
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

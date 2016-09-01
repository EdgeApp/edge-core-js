var crypto = require('../crypto.js')
var userMap = require('../userMap.js')
var UserStorage = require('../userStorage.js').UserStorage
var account = require('../account.js')

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
  return callback(null, new account.Account(ctx, username, dataKey))
}

function loginOnline (ctx, username, userId, password, callback) {
  var passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)

  // Encode the username:
  var request = {
    'userId': userId,
    'passwordAuth': passwordAuth.toString('base64')
    // "otp": null
  }
  ctx.authRequest('GET', '/v2/login', request, function (err, reply) {
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
      var userStorage = new UserStorage(ctx.localStorage, username)
      account.saveLoginReply(userStorage, reply, dataKey)
    } catch (e) {
      return callback(e)
    }
    return callback(null, new account.Account(ctx, username, dataKey))
  })
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @param callback function (err, keys)
 */
function login (ctx, username, password, callback) {
  username = userMap.normalize(username)
  var userId = userMap.getUserId(ctx.localStorage, username)

  loginOffline(ctx, username, userId, password, function (err, account) {
    if (!err) return callback(null, account)
    return loginOnline(ctx, username, userId, password, callback)
  })
}
exports.login = login

/**
 * Returns true if the given password is correct.
 */
function check (ctx, account, password) {
  // Extract stuff from storage:
  var userStorage = new UserStorage(ctx.localStorage, account.username)
  var passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  var passwordBox = userStorage.getJson('passwordBox')
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Keys missing from local storage')
  }

  try {
    // Decrypt the dataKey:
    var passwordKey = crypto.scrypt(account.username + password, passwordKeySnrp)
    crypto.decrypt(passwordBox, passwordKey)
  } catch (e) {
    return false
  }
  return true
}
exports.check = check

/**
 * Sets up a password for the account.
 */
function setup (ctx, account, password, callback) {
  var up = account.username + password

  // Create new keys:
  var passwordAuth = crypto.scrypt(up, crypto.passwordAuthSnrp)
  var passwordKeySnrp = crypto.makeSnrp()
  var passwordKey = crypto.scrypt(up, passwordKeySnrp)

  // Encrypt:
  var passwordBox = crypto.encrypt(account.dataKey, passwordKey)
  var passwordAuthBox = crypto.encrypt(passwordAuth, account.dataKey)

  var request = {
    'userId': account.userId,
    'passwordAuth': account.passwordAuth.toString('base64'),
    'password': {
      'passwordAuth': passwordAuth.toString('base64'),
      'passwordAuthSnrp': crypto.passwordAuthSnrp, // TODO: Not needed
      'passwordKeySnrp': passwordKeySnrp,
      'passwordBox': passwordBox,
      'passwordAuthBox': passwordAuthBox
    }
  }
  ctx.authRequest('PUT', '/v2/login/password', request, function (err, reply) {
    if (err) return callback(err)

    account.userStorage.setJson('passwordKeySnrp', passwordKeySnrp)
    account.userStorage.setJson('passwordBox', passwordBox)
    account.userStorage.setJson('passwordAuthBox', passwordAuthBox)
    account.passwordAuth = passwordAuth

    return callback(null)
  })
}
exports.setup = setup

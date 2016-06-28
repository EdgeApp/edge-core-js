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
  // Encode the username:
  var request = {
    'l1': userId
    // "otp": null
  }
  ctx.authRequest('POST', '/v1/account/carepackage/get', request, function (err, reply) {
    if (err) return callback(err)

    var carePackage = JSON.parse(reply['care_package'])
    var passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)

    var request = {
      'l1': userId,
      'lp1': passwordAuth.toString('base64')
      // "otp": null
    }
    ctx.authRequest('POST', '/v1/account/loginpackage/get', request, function (err, reply) {
      if (err) return callback(err)
      try {
        // Extract the login package components:
        var loginPackage = JSON.parse(reply['login_package'])
        var passwordBox = loginPackage['EMK_LP2']
        var syncKeyBox = loginPackage['ESyncKey']
        var authKeyBox = loginPackage['ELP1']
        var rootKeyBox = reply['rootKeyBox']
        var passwordKeySnrp = carePackage['SNRP2']
        if (!passwordKeySnrp || !authKeyBox || !passwordBox || !syncKeyBox) {
          return callback(Error('Missing data for login'))
        }
        if (!rootKeyBox) {
          return callback(Error('Non-upgraded account'))
        }

        // Decrypt the dataKey:
        var passwordKey = crypto.scrypt(username + password, passwordKeySnrp)
        var dataKey = crypto.decrypt(passwordBox, passwordKey)

        // Cache everything for future logins:
        userMap.insert(ctx.localStorage, username, userId)
        var userStorage = new UserStorage(ctx.localStorage, username)
        userStorage.setJson('passwordKeySnrp', passwordKeySnrp)
        userStorage.setJson('passwordBox', passwordBox)
        userStorage.setJson('authKeyBox', authKeyBox)
        userStorage.setJson('rootKeyBox', rootKeyBox)
        userStorage.setJson('syncKeyBox', syncKeyBox)
      } catch (e) {
        return callback(e)
      }
      return callback(null, new account.Account(ctx, username, dataKey))
    })
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

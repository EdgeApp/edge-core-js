var crypto = require('../crypto.js')
var userMap = require('../userMap.js')
var UserStorage = require('../userStorage.js').UserStorage
var account = require('../account.js')

function exists (ctx, username) {
  username = userMap.normalize(username)

  // Extract stuff from storage:
  var userStorage = new UserStorage(ctx.localStorage, username)
  var pinAuthId = userStorage.getItem('pinAuthId')
  var pinBox = userStorage.getJson('pinBox')
  if (!pinAuthId || !pinBox) {
    return false
  }

  return true
}
exports.exists = exists

function login (ctx, username, pin, callback) {
  username = userMap.normalize(username)

  // Extract stuff from storage:
  var userStorage = new UserStorage(ctx.localStorage, username)
  var passwordKeySnrp = userStorage.getJson('passwordKeySnrp')
  var pinAuthId = userStorage.getItem('pinAuthId')
  var pinBox = userStorage.getJson('pinBox')
  if (!passwordKeySnrp || !pinAuthId || !pinBox) {
    return callback(Error('Missing data for PIN login'))
  }

  var pinAuth = crypto.scrypt(username + pin, crypto.userAuthSnrp)
  var request = {
    'did': pinAuthId,
    'lpin1': pinAuth.toString('base64')
  }
  ctx.authRequest('POST', '/v1/account/pinpackage/get', request, function (err, reply) {
    if (err) return callback(err)
    try {
      var pinKeyBox = JSON.parse(reply['pin_package'])

      // Extract the data key:
      var pinKeyKey = crypto.scrypt(username + pin, passwordKeySnrp)
      var pinKey = crypto.decrypt(pinKeyBox, pinKeyKey)
      var dataKey = crypto.decrypt(pinBox, pinKey)
    } catch (e) {
      return callback(e)
    }
    return callback(null, new account.Account(ctx, username, dataKey))
  })
}
exports.login = login

function setup (ctx, account, pin, callback) {
  // Set up a device ID:
  var pinAuthId = account.userStorage.getItem('pinAuthId')
  if (!pinAuthId) {
    pinAuthId = crypto.random(32)
  }

  // Derive keys:
  var passwordKeySnrp = account.userStorage.getJson('passwordKeySnrp')
  var pinKey = crypto.random(32)
  var pinKeyKey = crypto.scrypt(account.username + pin, passwordKeySnrp)
  var pinAuth = crypto.scrypt(account.username + pin, crypto.userAuthSnrp)

  // Encrypt:
  var pinBox = crypto.encrypt(account.dataKey, pinKey)
  var pinKeyBox = crypto.encrypt(pinKey, pinKeyKey)

  var request = {
    'l1': account.authId,
    'lp1': account.authKey.toString('base64'),
    'lpin1': pinAuth.toString('base64'),
    'did': pinAuthId.toString('base64'),
    'pin_package': JSON.stringify(pinKeyBox),
    'ali': '2300-01-01T01:01:01' // 300 years in the future should be enough
  }
  ctx.authRequest('POST', '/v1/account/pinpackage/update', request, function (err, reply) {
    if (err) return callback(err)

    account.userStorage.setItem('pinAuthId', pinAuthId.toString('base64'))
    account.userStorage.setJson('pinBox', pinBox)

    return callback(null)
  })
}
exports.setup = setup

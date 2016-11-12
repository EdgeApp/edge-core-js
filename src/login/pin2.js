var base58 = require('../util/encoding.js').base58
var crypto = require('../crypto.js')
var userMap = require('../userMap.js')
var UserStorage = require('../userStorage.js').UserStorage
var Login = require('./login.js')

function pin2Id (pin2Key, username) {
  return new Buffer(crypto.hmacSha256(username, pin2Key))
}

function pin2Auth (pin2Key, pin) {
  return new Buffer(crypto.hmacSha256(pin, pin2Key))
}

/**
 * Returns true if the local device has a copy of the PIN login key.
 */
function getKey (ctx, username) {
  username = userMap.normalize(username)

  // Extract stuff from storage:
  var userStorage = new UserStorage(ctx.localStorage, username)
  return userStorage.getItem('pin2Key')
}
exports.getKey = getKey

/**
 * Logs a user in using their PIN.
 * @param username string
 * @param pin2Key the recovery key, as a base58 string.
 * @param pin the PIN, as a string.
 * @param callback function (err, login)
 */
function login (ctx, pin2Key, username, pin, callback) {
  pin2Key = base58.decode(pin2Key)
  username = userMap.normalize(username)

  var request = {
    'pin2Id': pin2Id(pin2Key, username).toString('base64'),
    'pin2Auth': pin2Auth(pin2Key, pin).toString('base64')
    // "otp": null
  }
  ctx.authRequest('POST', '/v2/login', request, function (err, reply) {
    if (err) return callback(err)

    try {
      // PIN login:
      var pin2Box = reply['pin2Box']
      if (!pin2Box) {
        return callback(Error('Missing data for PIN v2 login'))
      }

      // Decrypt the dataKey:
      var dataKey = crypto.decrypt(pin2Box, pin2Key)

      // Cache everything for future logins:
      var userId = userMap.getUserId(ctx.localStorage, username)
      userMap.insert(ctx.localStorage, username, userId)
    } catch (e) {
      return callback(e)
    }
    return callback(null, Login.online(ctx.localStorage, username, dataKey, reply))
  })
}
exports.login = login

/**
 * Sets up PIN login v2.
 */
function setup (ctx, login, pin, callback) {
  var pin2Key = login.userStorage.getItem('pin2Key')
  if (pin2Key) {
    pin2Key = base58.decode(pin2Key)
  } else {
    pin2Key = crypto.random(32)
  }

  var pin2Box = crypto.encrypt(login.dataKey, pin2Key)
  var pin2KeyBox = crypto.encrypt(pin2Key, login.dataKey)

  var request = login.authJson()
  request['data'] = {
    'pin2Id': pin2Id(pin2Key, login.username).toString('base64'),
    'pin2Auth': pin2Auth(pin2Key, pin).toString('base64'),
    'pin2Box': pin2Box,
    'pin2KeyBox': pin2KeyBox
  }
  ctx.authRequest('PUT', '/v2/login/pin2', request, function (err, reply) {
    if (err) return callback(err)

    pin2Key = base58.encode(pin2Key)
    login.userStorage.setItem('pin2Key', pin2Key)
    return callback(null, pin2Key)
  })
}
exports.setup = setup

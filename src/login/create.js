var bip39 = require('bip39')
var crypto = require('../crypto.js')
var userMap = require('../userMap.js')
var UserStorage = require('../userStorage.js').UserStorage
var account = require('../account.js')

/**
 * Determines whether or not a username is available.
 */
function usernameAvailable (ctx, username, callback) {
  username = userMap.normalize(username)

  var userId = userMap.getUserId(ctx.localStorage, username)
  var request = {
    'l1': userId
  }
  ctx.authRequest('POST', '/v1/account/available', request, function (err, reply) {
    if (err) return callback(err)
    return callback(null)
  })
}
exports.usernameAvailable = usernameAvailable

/**
 * Creates a new account on the auth server.
 */
function create (ctx, username, password, callback) {
  username = userMap.normalize(username)
  var userId = userMap.getUserId(ctx.localStorage, username)

  // Create random key material:
  var passwordKeySnrp = crypto.makeSnrp()
  var dataKey = crypto.random(32)
  var syncKey = crypto.random(32)

  // Derive keys from password:
  var passwordAuth = crypto.scrypt(username + password, crypto.passwordAuthSnrp)
  var passwordKey = crypto.scrypt(username + password, passwordKeySnrp)

  // Encrypt:
  var passwordBox = crypto.encrypt(dataKey, passwordKey)
  var authKeyBox = crypto.encrypt(passwordAuth, dataKey)
  var syncKeyBox = crypto.encrypt(syncKey, dataKey)

  // Package:
  var carePackage = {
    'SNRP2': passwordKeySnrp
  }
  var loginPackage = {
    'EMK_LP2': passwordBox,
    'ESyncKey': syncKeyBox,
    'ELP1': authKeyBox
  }
  var request = {
    'l1': userId,
    'lp1': passwordAuth.toString('base64'),
    'care_package': JSON.stringify(carePackage),
    'login_package': JSON.stringify(loginPackage),
    'repo_account_key': syncKey.toString('hex')
  }

  ctx.authRequest('POST', '/v1/account/create', request, function (err, reply) {
    if (err) return callback(err)

    // Cache everything for future logins:
    userMap.insert(ctx.localStorage, username, userId)
    var userStorage = new UserStorage(ctx.localStorage, username)
    userStorage.setJson('passwordKeySnrp', passwordKeySnrp)
    userStorage.setJson('passwordBox', passwordBox)
    userStorage.setJson('authKeyBox', authKeyBox)
    userStorage.setJson('syncKeyBox', syncKeyBox)

    // Now upgrade:
    upgrade(ctx, userStorage, userId, passwordAuth, dataKey, function (err) {
      if (err) return callback(err)

      // Now activate:
      var request = {
        'l1': userId,
        'lp1': passwordAuth.toString('base64')
      }
      ctx.authRequest('POST', '/v1/account/activate', request, function (err, reply) {
        if (err) return callback(err)
        return callback(null, new account.Account(ctx, username, dataKey))
      })
    })
  })
}
exports.create = create

function upgrade (ctx, userStorage, userId, authKey, dataKey, callback) {
  // Create a BIP39 mnemonic, and use it to derive the rootKey:
  var entropy = crypto.random(256 / 8)
  var mnemonic = bip39.entropyToMnemonic(entropy.toString('hex'))
  var rootKey = bip39.mnemonicToSeed(mnemonic)
  var infoKey = crypto.hmac_sha256(rootKey, 'infoKey')

  // Pack the keys into various boxes:
  var rootKeyBox = crypto.encrypt(rootKey, dataKey)
  var mnemonicBox = crypto.encrypt(new Buffer(mnemonic, 'utf-8'), infoKey)
  var dataKeyBox = crypto.encrypt(dataKey, infoKey)

  var request = {
    'l1': userId,
    'lp1': authKey.toString('base64'),
    'rootKeyBox': rootKeyBox,
    'mnemonicBox': mnemonicBox,
    'syncDataKeyBox': dataKeyBox
  }
  ctx.authRequest('POST', '/v1/account/upgrade', request, function (err, reply) {
    if (err) return callback(err)
    userStorage.setJson('rootKeyBox', rootKeyBox)
    return callback(null)
  })
}
exports.upgrade = create

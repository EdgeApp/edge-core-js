var BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
var base58 = require('base-x')(BASE58)
var crypto = require('../crypto.js')
var UserStorage = require('../userStorage.js').UserStorage
var userMap = require('../userMap.js')

/**
 * Unpacks a login v2 reply package, and stores the contents locally.
 */
function loginReplyStore (localStorage, username, dataKey, loginReply) {
  var userStorage = new UserStorage(localStorage, username)
  var keys = [
    // Password login:
    'passwordKeySnrp', 'passwordBox',
    // Key boxes:
    'passwordAuthBox', 'rootKeyBox', 'syncKeyBox', 'repos'
  ]

  // Store any keys the reply may contain:
  for (var i = 0; i < keys.length; ++i) {
    var key = keys[i]
    if (loginReply[key]) {
      userStorage.setJson(key, loginReply[key])
    }
  }

  // Store the recovery key unencrypted:
  var recovery2KeyBox = loginReply['recovery2KeyBox']
  if (recovery2KeyBox) {
    var recovery2Key = crypto.decrypt(recovery2KeyBox, dataKey)
    userStorage.setItem('recovery2Key', base58.encode(recovery2Key))
  }
}

/**
 * Access to the logged-in user data.
 *
 * This type has following powers:
 * - Access to the auth server
 * - A list of account repos
 * - The legacy BitID rootKey
 */
function Login (localStorage, username, dataKey) {
  // Identity:
  this.username = username
  this.userId = userMap.getUserId(localStorage, username)

  // Access to the login data:
  this.dataKey = dataKey
  this.userStorage = new UserStorage(localStorage, username)

  // Return access to the server:
  var passwordAuthBox = this.userStorage.getJson('passwordAuthBox')
  if (!passwordAuthBox) {
    throw new Error('Missing passwordAuthBox')
  }
  this.passwordAuth = crypto.decrypt(passwordAuthBox, dataKey)

  // Account repo:
  this.repos = this.userStorage.getJson('repos') || []
  var syncKeyBox = this.userStorage.getJson('syncKeyBox')
  if (syncKeyBox) {
    this.syncKey = crypto.decrypt(syncKeyBox, dataKey)
  }

  // Legacy BitID key:
  var rootKeyBox = this.userStorage.getJson('rootKeyBox')
  if (rootKeyBox) {
    this.rootKey = crypto.decrypt(rootKeyBox, dataKey)
  }
}

/**
 * Returns a new login object, populated with data from the server.
 */
Login.online = function (localStorage, username, dataKey, loginReply) {
  loginReplyStore(localStorage, username, dataKey, loginReply)
  return new Login(localStorage, username, dataKey)
}

/**
 * Returns a new login object, populated with data from the local storage.
 */
Login.offline = function (localStorage, username, dataKey) {
  return new Login(localStorage, username, dataKey)
}

module.exports = Login

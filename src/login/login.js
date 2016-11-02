var base58 = require('../util/encoding.js').base58
var crypto = require('../crypto.js')
var server = require('./server.js')
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

/**
 * Sets up a login v2 server authorization JSON.
 */
Login.prototype.authJson = function () {
  return {
    'userId': this.userId,
    'passwordAuth': this.passwordAuth.toString('base64')
  }
}

/**
 * Searches for the given account type in the provided login object.
 * Returns the repo keys in the JSON bundle format.
 */
Login.prototype.accountFind = function (type) {
  // Search the repos array:
  for (var i = 0; i < this.repos.length; ++i) {
    if (this.repos[i]['type'] === type) {
      var keysBox = this.repos[i]['keysBox'] || this.repos[i]['info']
      return JSON.parse(crypto.decrypt(keysBox, this.dataKey).toString('utf-8'))
    }
  }

  // Handle the legacy Airbitz repo:
  if (type === 'account:repo:co.airbitz.wallet') {
    return {
      'syncKey': this.syncKey.toString('hex'),
      'dataKey': this.dataKey.toString('hex')
    }
  }

  throw new Error('Cannot find a \'' + type + '\' repo')
}

/**
 * Creates and attaches new account repo.
 */
Login.prototype.accountCreate = function (ctx, type, callback) {
  var login = this

  server.repoCreate(ctx, login, {}, function (err, keysJson) {
    if (err) return callback(err)
    login.accountAttach(ctx, type, keysJson, function (err) {
      if (err) return callback(err)
      server.repoActivate(ctx, login, keysJson, function (err) {
        if (err) return callback(err)
        callback(null)
      })
    })
  })
}

/**
 * Attaches an account repo to the login.
 */
Login.prototype.accountAttach = function (ctx, type, info, callback) {
  var login = this

  var infoBlob = new Buffer(JSON.stringify(info), 'utf-8')
  var data = {
    'type': type,
    'info': crypto.encrypt(infoBlob, login.dataKey)
  }

  var request = login.authJson()
  request['data'] = data
  ctx.authRequest('POST', '/v2/login/repos', request, function (err, reply) {
    if (err) return callback(err)

    login.repos.push(data)
    login.userStorage.setJson('repos', login.repos)

    callback(null)
  })
}

module.exports = Login

var loginCreate = require('./login/create.js')
var loginPassword = require('./login/password.js')
var loginPin = require('./login/pin.js')
var loginRecovery2 = require('./login/recovery2.js')
var userMap = require('./userMap.js')
var UserStorage = require('./userStorage.js').UserStorage

var serverRoot = 'https://auth.airbitz.co/api'

/**
 * @param authRequest function (method, uri, body, callback (err, status, body))
 * @param localStorage an object compatible with the Web Storage API.
 */
function Context (authRequest, localStorage) {
  /**
   * Wraps the raw authRequest function in something more friendly.
   * @param body JSON object
   * @param callback function (err, reply JSON object)
   */
  this.authRequest = function (method, uri, body, callback) {
    authRequest(method, serverRoot + uri, body, function (err, status, body) {
      if (err) return callback(err)
      try {
        var reply = JSON.parse(body)
      } catch (e) {
        return callback(Error('Non-JSON reply, HTTP status ' + status))
      }

      // Look at the Airbitz status code:
      switch (reply['status_code']) {
        case 0:
          return callback(null, reply.results)
        default:
          return callback(Error(body))
      }
    })
  }

  this.localStorage = localStorage
}

Context.prototype.usernameList = function () {
  var map = userMap.load(this.localStorage)
  var out = []
  for (var username in map) {
    if (map.hasOwnProperty(username)) {
      out.push(username)
    }
  }
  return out
}
Context.prototype.listUsernames = Context.prototype.usernameList

Context.prototype.fixUsername = userMap.normalize

Context.prototype.usernameAvailable = function (username, callback) {
  return loginCreate.usernameAvailable(this, username, callback)
}

Context.prototype.accountCreate = function (username, password, callback) {
  return loginCreate.create(this, username, password, callback)
}
Context.prototype.createAccount = function (username, password, pin, opts, callback) {
  return loginCreate.create(this, username, password, function (err, account) {
    if (err) return callback(err)
    loginPin.setup(this, account, pin, callback)
  })
}

Context.prototype.passwordLogin = function (username, password, callback) {
  return loginPassword.login(this, username, password, callback)
}
Context.prototype.loginWithPassword = function (username, password, otp, opts, callback) {
  return loginPassword.login(this, username, password, callback)
}

Context.prototype.pinExists = function (username) {
  return loginPin.exists(this, username)
}
Context.prototype.pinLoginEnabled = function (username) {
  return loginPin.exists(this, username)
}

Context.prototype.pinLogin = function (username, pin, callback) {
  return loginPin.login(this, username, pin, callback)
}
Context.prototype.loginWithPIN = function (username, pin, opts, callback) {
  return loginPin.login(this, username, pin, callback)
}

Context.prototype.getRecovery2Key = function (username, callback) {
  var userStorage = new UserStorage(this.localStorage, username)
  var recovery2Key = userStorage.getItem('recovery2Key')
  if (recovery2Key) {
    callback(null, recovery2Key)
  } else {
    callback(new Error('No recovery key stored locally.'))
  }
}

Context.prototype.loginWithRecovery2 = function (recovery2Key, username, answers, otp, options, callback) {
  return loginRecovery2.login(this, recovery2Key, username, answers, callback)
}

Context.prototype.fetchRecovery2Questions = function (recovery2Key, username, callback) {
  return loginRecovery2.questions(this, recovery2Key, username, callback)
}

Context.prototype.checkPasswordRules = function (password) {
  var tooShort = password.length < 10
  var noNumber = password.match(/\d/) == null
  var noUpperCase = password.match(/[A-Z]/) == null
  var noLowerCase = password.match(/[a-z]/) == null

  return {
    'tooShort': tooShort,
    'noNumber': noNumber,
    'noUpperCase': noUpperCase,
    'noLowerCase': noLowerCase,
    'passed': !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}

exports.Context = Context

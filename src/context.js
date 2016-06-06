var loginCreate = require('./login/create.js')
var loginPassword = require('./login/password.js')
var loginPin = require('./login/pin.js')

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

Context.prototype.usernameAvailable = function (username, callback) {
  return loginCreate.usernameAvailable(this, username, callback)
}

Context.prototype.accountCreate = function (username, password, callback) {
  return loginCreate.create(this, username, password, callback)
}

Context.prototype.passwordLogin = function (username, password, callback) {
  return loginPassword.login(this, username, password, callback)
}

Context.prototype.pinExists = function (username) {
  return loginPin.exists(this, username)
}

Context.prototype.pinLogin = function (username, pin, callback) {
  return loginPin.login(this, username, pin, callback)
}

exports.Context = Context

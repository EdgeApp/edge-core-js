var userMap = require('./userMap.js')
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
  var ctx = this
  username = userMap.normalize(username)

  var authId = userMap.getAuthId(ctx.localStorage, username)
  var request = {
    'l1': authId
  }
  ctx.authRequest('POST', '/v1/account/available', request, function (err, reply) {
    if (err) return callback(err)
    return callback(null)
  })
}

Context.prototype.accountCreate = function (username, pin, callback) {
  callback(Error())
}

Context.prototype.passwordLogin = function (username, password, callback) {
  loginPassword.login(this, username, password, callback)
}

Context.prototype.pinLogin = function (username, pin, callback) {
  loginPin.login(this, username, pin, callback)
}

exports.Context = Context

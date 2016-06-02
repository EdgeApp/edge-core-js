var userMap = require('../userMap.js')

/**
 * Determines whether or not a username is available.
 */
function usernameAvailable (ctx, username, callback) {
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
exports.usernameAvailable = usernameAvailable

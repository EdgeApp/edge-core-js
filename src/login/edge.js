var crypto = require('../crypto.js')
var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')

/**
 * Opens a lobby object to determine if it contains a resolved account request.
 * Returns the account info if so, or null otherwise.
 */
function decodeAccountReply (keys, reply) {
  var accountRequest = reply['accountRequest']
  var replyKey = accountRequest['replyKey']
  var infoBox = accountRequest['infoBox']
  var type = accountRequest['type']

  // If the reply is missing, just return false:
  if (!replyKey || !infoBox) {
    return null
  }

  var replyPubkey = secp256k1.keyFromPublic(replyKey, 'hex').getPublic()
  var secret = keys.derive(replyPubkey).toArray('be')
  var infoKey = Buffer(crypto.hmac_sha256('infoKey', new Uint8Array(secret)))
  var info = JSON.parse(crypto.decrypt(infoBox, infoKey).toString('utf-8'))

  return {type: type, info: info}
}
exports.decodeAccountReply = decodeAccountReply

/**
 * Polls the lobby every second or so,
 * looking for a reply to our account request.
 */
function pollServer (ctx, id, keys, onLogin) {
  setTimeout(function () {
    ctx.authRequest('GET', '/v2/lobby/' + id, '', function (err, reply) {
      if (err) return pollServer(ctx, id, keys, onLogin)

      try {
        var account = decodeAccountReply(keys, reply)
        if (account) {
          // TODO: We need to create a device-local login,
          // and attach the repo info to that.
          return onLogin(account.type, account.info)
        }
      } catch (e) {
        console.log(e)
      }
      return pollServer(ctx, id, keys, onLogin)
    })
  }, 1000)
}

/**
 * Creates a new account request lobby on the server.
 */
function create (ctx, opts, callback) {
  var keys = secp256k1.genKeyPair()

  var data = {
    'accountRequest': {
      'displayName': opts['displayName'] || '',
      'requestKey': keys.getPublic().encodeCompressed('hex'),
      'type': ctx.accountType
    }
  }

  var request = {
    'expires': 300,
    'data': data
  }

  ctx.authRequest('POST', '/v2/lobby', request, function (err, reply) {
    if (err) return callback(err)

    try {
      var id = reply['id']
      pollServer(ctx, id, keys, opts.onLogin)
    } catch (e) {
      return callback(e)
    }
    return callback(null, {'id': id})
  })
}
exports.create = create

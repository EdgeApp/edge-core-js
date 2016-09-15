var loginCreate = require('./create.js')
var crypto = require('../crypto.js')
var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')

/**
 * Creates a new login object, and attaches the account repo info to it.
 */
function createLogin (ctx, account, callback) {
  var username = crypto.random(24).toString('base64')
  var password = crypto.random(24).toString('base64')

  var opts = {}
  if (account.type === 'account:repo:co.airbitz.wallet') {
    opts.syncKey = Buffer(account.info['syncKey'], 'hex')
  }

  loginCreate.create(ctx, username, password, opts, function (err, login) {
    if (err) return callback(err)
    login.accountAttach(ctx, account.type, account.info, function (err) {
      if (err) return callback(err)
      callback(null, login)
    })
  })
}

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
      if (err) return onLogin(err)

      try {
        var account = decodeAccountReply(keys, reply)
        if (!account) {
          return pollServer(ctx, id, keys, onLogin)
        }
        createLogin(ctx, account, onLogin)
      } catch (e) {
        return onLogin(e)
      }
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

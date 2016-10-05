var loginCreate = require('./create.js')
var crypto = require('../crypto.js')
var loginPin = require('./pin.js')

var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')
var BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
var base58 = require('base-x')(BASE58)

function ABCEdgeLoginRequest (id) {
  this.id = id
  this.done_ = false
}

ABCEdgeLoginRequest.prototype.cancelRequest = function () {
  this.done_ = true
}

/**
 * Creates a new login object, and attaches the account repo info to it.
 */
function createLogin (ctx, accountReply, callback) {
  var username = accountReply.username + '-' + base58.encode(crypto.random(4))
  var password = base58.encode(crypto.random(24))
  var pin = accountReply.pin

  var opts = {}
  if (accountReply.type === 'account:repo:co.airbitz.wallet') {
    opts.syncKey = Buffer(accountReply.info['syncKey'], 'hex')
  }

  loginCreate.create(ctx, username, password, opts, function (err, login) {
    if (err) return callback(err)
    login.accountAttach(ctx, accountReply.type, accountReply.info, function (err) {
      if (err) return callback(err)

      if (typeof pin === 'string' && pin.length === 4) {
        if (!loginPin.exists(ctx, username)) {
          loginPin.setup(ctx, login, pin, function (err) {
            if (err) {
              // Do nothing
            }
            callback(null, login)
          })
          return
        }
      }
      callback(null, login)
    })
  })
}

/**
 * Opens a lobby object to determine if it contains a resolved account request.
 * Returns the account info if so, or null otherwise.
 */
function decodeAccountReply (keys, lobby) {
  var accountRequest = lobby['accountRequest']
  var replyBox = accountRequest['replyBox']
  var replyKey = accountRequest['replyKey']
  var type = accountRequest['type']

  // If the reply is missing, just return false:
  if (!replyBox || !replyKey) {
    return null
  }

  var replyPubkey = secp256k1.keyFromPublic(replyKey, 'hex').getPublic()
  var secret = keys.derive(replyPubkey).toArray('be')
  var dataKey = Buffer(crypto.hmac_sha256('dataKey', new Uint8Array(secret)))
  var reply = JSON.parse(crypto.decrypt(replyBox, dataKey).toString('utf-8'))

  var info = reply['info']
  var username = reply['username']
  var pin = null
  if (typeof reply.pinString === 'string') {
    pin = reply.pinString
  }

  return {type, info, username, pin}
}
exports.decodeAccountReply = decodeAccountReply

/**
 * Polls the lobby every second or so,
 * looking for a reply to our account request.
 */
function pollServer (ctx, edgeLogin, keys, onLogin) {
  // Don't do anything if the user has cancelled this request:
  if (edgeLogin.done_) {
    return
  }

  setTimeout(function () {
    ctx.authRequest('GET', '/v2/lobby/' + edgeLogin.id, '', function (err, reply) {
      if (err) return onLogin(err)

      try {
        var accountReply = decodeAccountReply(keys, reply)
        if (!accountReply) {
          return pollServer(ctx, edgeLogin, keys, onLogin)
        }
        createLogin(ctx, accountReply, onLogin)
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
      'type': opts.type
    }
  }

  if (typeof opts.displayImageUrl === 'string') {
    data.accountRequest.displayImageUrl = opts.displayImageUrl
  } else {
    data.accountRequest.displayImageUrl = ''
  }

  var request = {
    'expires': 300,
    'data': data
  }

  ctx.authRequest('POST', '/v2/lobby', request, function (err, reply) {
    if (err) return callback(err)

    try {
      var edgeLogin = new ABCEdgeLoginRequest(reply.id)
      pollServer(ctx, edgeLogin, keys, opts.onLogin)
    } catch (e) {
      return callback(e)
    }
    return callback(null, edgeLogin)
  })
}
exports.create = create

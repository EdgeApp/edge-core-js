var loginCreate = require('./create.js')
var base58 = require('../util/encoding.js').base58
var crypto = require('../crypto.js')
var loginPin = require('./pin.js')

var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')

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
  var pin = accountReply.pinString

  var opts = {}
  if (accountReply.type === 'account:repo:co.airbitz.wallet') {
    opts.syncKey = new Buffer(accountReply.info['syncKey'], 'hex')
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

  // If the reply is missing, just return false:
  if (!replyBox || !replyKey) {
    return null
  }

  var replyPubkey = secp256k1.keyFromPublic(replyKey, 'hex').getPublic()
  var secret = keys.derive(replyPubkey).toArray('be')
  var dataKey = new Buffer(crypto.hmac_sha256('dataKey', new Uint8Array(secret)))
  var reply = JSON.parse(crypto.decrypt(replyBox, dataKey).toString('utf-8'))

  var returnObj = {
    type: accountRequest['type'],
    info: reply['info'],
    username: reply['username']
  }
  if (typeof reply.pinString === 'string') {
    returnObj.pinString = reply['pinString']
  }

  return returnObj
}
exports.decodeAccountReply = decodeAccountReply

/**
 * Polls the lobby every second or so,
 * looking for a reply to our account request.
 */
function pollServer (ctx, edgeLogin, keys, onLogin, onProcessLogin) {
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
          return pollServer(ctx, edgeLogin, keys, onLogin, onProcessLogin)
        }
        if (onProcessLogin !== null) {
          onProcessLogin(accountReply.username)
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
      var onProcessLogin = null
      if (opts.hasOwnProperty('onProcessLogin')) {
        onProcessLogin = opts.onProcessLogin
      }
      pollServer(ctx, edgeLogin, keys, opts.onLogin, onProcessLogin)
    } catch (e) {
      return callback(e)
    }
    return callback(null, edgeLogin)
  })
}
exports.create = create

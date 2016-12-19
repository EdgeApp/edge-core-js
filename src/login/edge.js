import * as crypto from '../crypto/crypto.js'
import {base58} from '../util/encoding.js'
import * as loginCreate from './create.js'
import * as loginPin2 from './pin2.js'
import elliptic from 'elliptic'

const EllipticCurve = elliptic.ec
const secp256k1 = new EllipticCurve('secp256k1')

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
function createLogin (ctx, accountReply) {
  const username = accountReply.username + '-' + base58.encode(crypto.random(4))
  const password = base58.encode(crypto.random(24))
  const pin = accountReply.pinString

  const opts = {}
  if (accountReply.type === 'account:repo:co.airbitz.wallet') {
    opts.syncKey = new Buffer(accountReply.info['syncKey'], 'hex')
  }

  return loginCreate.create(ctx, username, password, opts).then(login => {
    return login.accountAttach(ctx, accountReply.type, accountReply.info).then(() => {
      if (typeof pin === 'string' && pin.length === 4) {
        if (loginPin2.getKey(ctx, username) == null) {
          return loginPin2.setup(ctx, login, pin).then(() => login, () => login)
        }
      }
      return login
    })
  })
}

/**
 * Opens a lobby object to determine if it contains a resolved account request.
 * Returns the account info if so, or null otherwise.
 */
export function decodeAccountReply (keys, lobby) {
  const accountRequest = lobby['accountRequest']
  const replyBox = accountRequest['replyBox']
  const replyKey = accountRequest['replyKey']

  // If the reply is missing, just return false:
  if (!replyBox || !replyKey) {
    return null
  }

  const replyPubkey = secp256k1.keyFromPublic(replyKey, 'hex').getPublic()
  const secret = keys.derive(replyPubkey).toArray('be')
  const dataKey = new Buffer(crypto.hmacSha256('dataKey', new Uint8Array(secret)))
  const reply = JSON.parse(crypto.decrypt(replyBox, dataKey).toString('utf-8'))

  const returnObj = {
    type: accountRequest['type'],
    info: reply['keys'] || reply['info'],
    username: reply['username']
  }
  if (typeof reply.pinString === 'string') {
    returnObj.pinString = reply['pinString']
  }

  return returnObj
}

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
    ctx.authRequest('GET', '/v2/lobby/' + edgeLogin.id, '').then(reply => {
      const accountReply = decodeAccountReply(keys, reply)
      if (!accountReply) {
        return pollServer(ctx, edgeLogin, keys, onLogin, onProcessLogin)
      }
      if (onProcessLogin !== null) {
        onProcessLogin(accountReply.username)
      }
      return createLogin(ctx, accountReply).then(
        login => onLogin(null, login), e => onLogin(e)
      )
    }).catch(e => {
      return onLogin(e)
    })
  }, 1000)
}

/**
 * Creates a new account request lobby on the server.
 */
export function create (ctx, opts) {
  const keys = secp256k1.genKeyPair()

  const data = {
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

  const request = {
    'expires': 300,
    'data': data
  }

  return ctx.authRequest('POST', '/v2/lobby', request).then(reply => {
    const edgeLogin = new ABCEdgeLoginRequest(reply.id)
    let onProcessLogin = null
    if (opts.hasOwnProperty('onProcessLogin')) {
      onProcessLogin = opts.onProcessLogin
    }
    pollServer(ctx, edgeLogin, keys, opts.onLogin, onProcessLogin)
    return edgeLogin
  })
}

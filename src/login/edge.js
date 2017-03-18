import * as crypto from '../crypto/crypto.js'
import {elliptic} from '../crypto/external.js'
import { base58, base64, utf8 } from '../util/encoding.js'
import { createLogin, createChildLogin } from './create.js'
import { makeKeyInfo } from './login.js'

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
function createEdgeLogin (io, accountReply) {
  const username = accountReply.username + '-' + base58.stringify(io.random(4))

  const opts = {
    password: base58.stringify(io.random(24)),
    pin: accountReply.pinString
  }
  if (accountReply.pinString != null) {
    opts.pin = accountReply.pinString
  }
  return createLogin(io, username, opts).then(rootLogin => {
    const dataKey = base64.parse(accountReply.info.dataKey)
    const keyInfo = makeKeyInfo(accountReply.info, accountReply.type, dataKey)
    const opts = {
      pin: accountReply.pinString,
      keyInfos: [keyInfo]
    }
    const appId = accountReply.type.replace(/account.repo:/, '')
    return createChildLogin(io, rootLogin, rootLogin, appId, opts).then(
      login => rootLogin
    )
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
  if (replyBox == null || replyKey == null) {
    return null
  }

  const replyPubkey = secp256k1.keyFromPublic(replyKey, 'hex').getPublic()
  const secret = keys.derive(replyPubkey).toArray('be')
  const dataKey = crypto.hmacSha256('dataKey', new Uint8Array(secret))
  const reply = JSON.parse(utf8.stringify(crypto.decrypt(replyBox, dataKey)))

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
function pollServer (io, edgeLogin, keys, onLogin, onProcessLogin) {
  // Don't do anything if the user has cancelled this request:
  if (edgeLogin.done_) {
    return
  }

  setTimeout(function () {
    io.authRequest('GET', '/v2/lobby/' + edgeLogin.id, '').then(reply => {
      const accountReply = decodeAccountReply(keys, reply)
      if (accountReply == null) {
        return pollServer(io, edgeLogin, keys, onLogin, onProcessLogin)
      }
      if (onProcessLogin != null) {
        onProcessLogin(accountReply.username)
      }
      return createEdgeLogin(io, accountReply).then(
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
export function create (io, opts) {
  const keys = secp256k1.genKeyPair({entropy: io.random(32)})

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

  return io.authRequest('POST', '/v2/lobby', request).then(reply => {
    const edgeLogin = new ABCEdgeLoginRequest(reply.id)
    let onProcessLogin = null
    if (opts.onProcessLogin != null) {
      onProcessLogin = opts.onProcessLogin
    }
    pollServer(io, edgeLogin, keys, opts.onLogin, onProcessLogin)
    return edgeLogin
  })
}

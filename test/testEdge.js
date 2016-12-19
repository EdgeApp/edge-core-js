/* global describe, it */
import * as crypto from '../src/crypto/crypto.js'
import * as loginEdge from '../src/login/edge.js'
import {makeSession} from './fake/session.js'
import assert from 'assert'
import elliptic from 'elliptic'

const EllipticCurve = elliptic.ec
const secp256k1 = new EllipticCurve('secp256k1')

const fakeReply = {
  username: 'test',
  pinString: '1234',
  keys: {
    dataKey: 'fa57',
    syncKey: 'f00d'
  }
}

/**
 * Modifies the lobby object with a fake reply to an account request.
 */
function craftFakeReply (lobby) {
  const accountRequest = lobby['accountRequest']
  const requestKey = accountRequest['requestKey']

  const keys = secp256k1.genKeyPair()
  const requestPubkey = secp256k1.keyFromPublic(requestKey, 'hex').getPublic()
  const secret = keys.derive(requestPubkey).toArray('be')
  const dataKey = new Buffer(crypto.hmacSha256('dataKey', new Uint8Array(secret)))

  const replyBlob = new Buffer(JSON.stringify(fakeReply), 'utf-8')
  accountRequest['replyBox'] = crypto.encrypt(replyBlob, dataKey)
  accountRequest['replyKey'] = keys.getPublic().encodeCompressed('hex')
}

describe('edge login', function () {
  it('decode reply', function () {
    const key = secp256k1.keyFromPrivate('ab989c9ac164effe74d89c0ab0e7dc2345f8e091f43bba2c02d99ed4aa107af1')
    const lobby = {
      'accountRequest': {
        'displayName': 'test',
        'replyBox': {
          'data_base64': 'uMhgQkfFJT9G8jTov/3uF0ntPlv50Gp6U5cqu7kBgrvJ3tt22gQ0iJDFWWIAiB1aQ3VoZQLo+uJzbfBUXByc5UjhHGaZNudW77YOQL4egoTBFPDz2UybcPq9feClGCbKbJw1ayTyfl7oQxIa8p8oOHCs+3UQbpHRTAjGaVPId7g=',
          'encryptionType': 0,
          'iv_hex': 'ba70845459c593e63bab244b00cc5a69'
        },
        'replyKey': '022484c4e59a4a7638045fcb232f7ead696510127276feb37441e3e071117d9cdd',
        'requestKey': '033affa1149e4263db9a7e8320a7f612ffb76dd3099d8786eca8e70a27e48e0ece',
        'type': 'account:repo:co.airbitz.wallet'
      }
    }

    assert.deepEqual(loginEdge.decodeAccountReply(key, lobby), {
      'type': 'account:repo:co.airbitz.wallet',
      'username': 'test',
      'info': {
        'test': 'test'
      }
    })
  })

  it('request', function (done) {
    this.timeout(9000)
    const session = makeSession({needsContext: true, accountType: 'account:repo:test'})
    session.server.repos['f00d'] = {}

    const opts = {
      onLogin: function (err, account) {
        if (err) return done(err)
        assert.deepEqual(account.keys, fakeReply.keys)
        done()
      },
      displayName: 'test suite'
    }

    session.context.requestEdgeLogin(opts, function (err, id) {
      if (err) return done(err)
      craftFakeReply(session.server.db.lobby)
    })
  })

  it('cancel', function (done) {
    const session = makeSession({needsContext: true, accountType: 'account:repo:test'})

    const opts = {
      onLogin: function () {},
      displayName: 'test suite'
    }

    session.context.requestEdgeLogin(opts, function (err, pendingLogin) {
      if (err) return done(err)
      // All we can verify here is that cancel is a callable method:
      pendingLogin.cancelRequest()
      done()
    })
  })
})

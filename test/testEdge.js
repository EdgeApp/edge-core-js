/* global describe, it */
var abc = require('../src/abc.js')
var assert = require('assert')
var crypto = require('../src/crypto.js')
var FakeStorage = require('./fake/fakeStorage.js').FakeStorage
var FakeServer = require('./fake/fakeServer.js').FakeServer
var loginEdge = require('../src/login/edge.js')
var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')

var fakeRepoInfo = {
  dataKey: 'fa57',
  syncKey: 'f00d'
}

/**
 * Modifies the lobby object with a fake reply to an account request.
 */
function craftFakeReply (lobby) {
  var accountRequest = lobby['accountRequest']
  var requestKey = accountRequest['requestKey']

  var keys = secp256k1.genKeyPair()
  var requestPubkey = secp256k1.keyFromPublic(requestKey, 'hex').getPublic()
  var secret = keys.derive(requestPubkey).toArray('be')
  var infoKey = Buffer(crypto.hmac_sha256('infoKey', new Uint8Array(secret)))

  var infoBlob = Buffer(JSON.stringify(fakeRepoInfo), 'utf-8')
  accountRequest['replyKey'] = keys.getPublic().encodeCompressed('hex')
  accountRequest['infoBox'] = crypto.encrypt(infoBlob, infoKey)
}

describe('edge login', function () {
  it('decode reply', function () {
    var key = secp256k1.keyFromPrivate('ab989c9ac164effe74d89c0ab0e7dc2345f8e091f43bba2c02d99ed4aa107af1')
    var lobby = {
      'accountRequest': {
        'displayName': 'test',
        'infoBox': {
          'data_base64': 'U0/LXPWun5eGGsswqlfuc9pi+qTt+WWz+Q/EVBdBbZQ7fZp4QCwYrMvGjZNUGJE/r7SQx0+wDG6gFwG+SH+Bv1HcbkM8cNWsjQ12Ib+PauX7lWPkCUBnhDIUYlglNVTB',
          'encryptionType': 0,
          'iv_hex': '015ba17658ddb4e06560c796e2b8ab4a'
        },
        'replyKey': '021d0311430a72a192b4a519a20278e75f91f098af6cadfe07b67c9606c2abaec6',
        'requestKey': '033affa1149e4263db9a7e8320a7f612ffb76dd3099d8786eca8e70a27e48e0ece',
        'type': 'account:repo:co.airbitz.wallet'
      }
    }

    assert.deepEqual(loginEdge.decodeAccountReply(key, lobby), {
      'type': 'account:repo:co.airbitz.wallet',
      'info': {
        'test': 'test'
      }
    })
  })

  it('request', function (done) {
    this.timeout(3000)
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage, 'account:repo:test')

    var opts = {
      onLogin: function (err, account) {
        if (err) return done(err)
        assert.deepEqual(account.repoInfo, fakeRepoInfo)
        done()
      },
      displayName: 'test suite'
    }

    ctx.requestEdgeLogin(opts, function (err, id) {
      if (err) return done(err)
      craftFakeReply(fakeServer.db.lobby)
    })
  })

  it('cancel', function (done) {
    var fakeStorage = new FakeStorage()
    var fakeServer = new FakeServer()
    var ctx = new abc.Context(fakeServer.bindRequest(), fakeStorage, 'account:repo:test')

    var opts = {
      onLogin: function () {},
      displayName: 'test suite'
    }

    ctx.requestEdgeLogin(opts, function (err, pendingLogin) {
      if (err) return done(err)
      // All we can verify here is that cancel is a callable method:
      pendingLogin.cancel()
      done()
    })
  })
})

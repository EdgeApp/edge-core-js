/* global describe, it */
var assert = require('assert')
var loginEdge = require('../src/login/edge.js')
var Elliptic = require('elliptic').ec
var secp256k1 = new Elliptic('secp256k1')

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
})


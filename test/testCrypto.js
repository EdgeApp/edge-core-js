/* global describe, it */
var assert = require('assert')
var crypto = require('../src/crypto.js')

describe('scrypt', function () {
  it('match a known authId', function () {
    var password = 'william test'
    var result = 'TGnly9w3Fch7tyJVO+0MWLpvlbMGgWODf/tFlNkV6js='
    var snrp = crypto.userAuthSnrp

    assert.equal(result, crypto.scrypt(password, snrp).toString('base64'))
  })
})

describe('encryption', function () {
  it('decrypt existing data', function () {
    var key = Buffer.from('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393', 'hex')
    var box = {
      'data_base64': 'X08Snnou2PrMW21ZNyJo5C8StDjTNgMtuEoAJL5bJ6LDPdZGQLhjaUMetOknaPYnmfBCHNQ3ApqmE922Hkp30vdxzXBloopfPLJKdYwQxURYNbiL4TvNakP7i0bnTlIsR7bj1q/65ZyJOW1HyOKV/tmXCf56Fhe3Hcmb/ebsBF72FZr3jX5pkSBO+angK15IlCIiem1kPi6QmzyFtMB11i0GTjSS67tLrWkGIqAmik+bGqy7WtQgfMRxQNNOxePPSHHp09431Ogrc9egY3txnBN2FKnfEM/0Wa/zLWKCVQXCGhmrTx1tmf4HouNDOnnCgkRWJYs8FJdrDP8NZy4Fkzs7FoH7RIaUiOvosNKMil1CBknKremP6ohK7SMLGoOHpv+bCgTXcAeB3P4Slx3iy+RywTSLb3yh+HDo6bwt+vhujP0RkUamI5523bwz3/7vLO8BzyF6WX0By2s4gvMdFQ==',
      'encryptionType': 0,
      'iv_hex': '96a4cd52670c13df9712fdc1b564d44b'
    }

    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })

  it('round-trip data', function () {
    var key = Buffer.from('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393', 'hex')
    var data = Buffer.from('payload', 'utf8')
    var box = crypto.encrypt(data, key)
    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })
})

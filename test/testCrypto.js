/* global describe, it */
import {makeFakeContexts, makeRandomGenerator} from '../src'
import * as crypto from '../src/crypto/crypto.js'
import * as scrypt from '../src/crypto/scrypt.js'
import {base16, base64, utf8} from '../src/util/encoding.js'
import assert from 'assert'

describe('scrypt', function () {
  it('match a known userId', function () {
    const password = 'william test'
    const result = 'TGnly9w3Fch7tyJVO+0MWLpvlbMGgWODf/tFlNkV6js='
    const snrp = scrypt.userIdSnrp

    return scrypt.scrypt(password, snrp).then(userId => {
      return assert.equal(base64.stringify(userId), result)
    })
  })
})

describe('encryption', function () {
  it('decrypt existing data', function () {
    const key = base16.parse('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393')
    const box = {
      'data_base64': 'X08Snnou2PrMW21ZNyJo5C8StDjTNgMtuEoAJL5bJ6LDPdZGQLhjaUMetOknaPYnmfBCHNQ3ApqmE922Hkp30vdxzXBloopfPLJKdYwQxURYNbiL4TvNakP7i0bnTlIsR7bj1q/65ZyJOW1HyOKV/tmXCf56Fhe3Hcmb/ebsBF72FZr3jX5pkSBO+angK15IlCIiem1kPi6QmzyFtMB11i0GTjSS67tLrWkGIqAmik+bGqy7WtQgfMRxQNNOxePPSHHp09431Ogrc9egY3txnBN2FKnfEM/0Wa/zLWKCVQXCGhmrTx1tmf4HouNDOnnCgkRWJYs8FJdrDP8NZy4Fkzs7FoH7RIaUiOvosNKMil1CBknKremP6ohK7SMLGoOHpv+bCgTXcAeB3P4Slx3iy+RywTSLb3yh+HDo6bwt+vhujP0RkUamI5523bwz3/7vLO8BzyF6WX0By2s4gvMdFQ==',
      'encryptionType': 0,
      'iv_hex': '96a4cd52670c13df9712fdc1b564d44b'
    }

    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })

  it('round-trip data', function () {
    const [context] = makeFakeContexts(1)
    const key = base16.parse('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393')
    const data = utf8.parse('payload')
    const box = crypto.encrypt(context.io, data, key)
    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })
})

describe('hashes', function () {
  it('hmac-sha256', function () {
    const data = utf8.parse('The quick brown fox jumps over the lazy dog')
    const key = utf8.parse('key')
    const expected = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'

    assert.equal(expected, base16.stringify(crypto.hmacSha256(data, key)))
  })

  it('sha256', function () {
    const data = utf8.parse('This is a test')
    const expected = 'c7be1ed902fb8dd4d48997c6452f5d7e509fbcdbe2808b16bcf4edce4c07d14e'

    assert.equal(expected, base16.stringify(crypto.sha256(data)))
  })
})

describe('hmac-drbg', function () {
  it('generate known output', function () {
    const [context] = makeFakeContexts(1)
    const f = makeRandomGenerator(context.io.random(32))

    const expected = 'd62447f86f81284e09441569489821f0'
    assert.equal(base16.stringify(f(16)), expected)
  })
})

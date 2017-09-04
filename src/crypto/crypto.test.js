/* global describe, it */
import { makeFakeIos } from '../indexABC.js'
import { base16, base64, utf8 } from '../util/encoding.js'
import { decrypt, encrypt, hmacSha256, sha256 } from './crypto.js'
import { scrypt } from './scrypt.js'
import assert from 'assert'

describe('scrypt', function () {
  it('match a known userId', function () {
    const password = utf8.parse('william test')
    const salt = base16.parse(
      'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b'
    )
    const result = 'TGnly9w3Fch7tyJVO+0MWLpvlbMGgWODf/tFlNkV6js='

    return scrypt(password, salt, 16384, 1, 1, 32).then(userId => {
      return assert.equal(base64.stringify(userId), result)
    })
  })
})

describe('encryption', function () {
  it('decrypt existing data', function () {
    const key = base16.parse(
      '002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393'
    )
    const box = {
      data_base64:
        'X08Snnou2PrMW21ZNyJo5C8StDjTNgMtuEoAJL5bJ6LDPdZGQLhjaUMetOknaPYnmfBCHNQ3ApqmE922Hkp30vdxzXBloopfPLJKdYwQxURYNbiL4TvNakP7i0bnTlIsR7bj1q/65ZyJOW1HyOKV/tmXCf56Fhe3Hcmb/ebsBF72FZr3jX5pkSBO+angK15IlCIiem1kPi6QmzyFtMB11i0GTjSS67tLrWkGIqAmik+bGqy7WtQgfMRxQNNOxePPSHHp09431Ogrc9egY3txnBN2FKnfEM/0Wa/zLWKCVQXCGhmrTx1tmf4HouNDOnnCgkRWJYs8FJdrDP8NZy4Fkzs7FoH7RIaUiOvosNKMil1CBknKremP6ohK7SMLGoOHpv+bCgTXcAeB3P4Slx3iy+RywTSLb3yh+HDo6bwt+vhujP0RkUamI5523bwz3/7vLO8BzyF6WX0By2s4gvMdFQ==',
      encryptionType: 0,
      iv_hex: '96a4cd52670c13df9712fdc1b564d44b'
    }

    assert.deepEqual('payload', utf8.stringify(decrypt(box, key)))
  })

  it('round-trip data', function () {
    const [io] = makeFakeIos(1)
    const key = base16.parse(
      '002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393'
    )
    const data = utf8.parse('payload')
    const box = encrypt(io, data, key)
    assert.deepEqual('payload', utf8.stringify(decrypt(box, key)))
  })
})

describe('hashes', function () {
  it('hmac-sha256', function () {
    const data = utf8.parse('The quick brown fox jumps over the lazy dog')
    const key = utf8.parse('key')
    const expected =
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'

    assert.equal(expected, base16.stringify(hmacSha256(data, key)))
  })

  it('sha256', function () {
    const data = utf8.parse('This is a test')
    const expected =
      'c7be1ed902fb8dd4d48997c6452f5d7e509fbcdbe2808b16bcf4edce4c07d14e'

    assert.equal(expected, base16.stringify(sha256(data)))
  })
})

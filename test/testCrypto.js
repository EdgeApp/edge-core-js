/* global describe, it */
import * as crypto from '../src/crypto/crypto.js'
import * as scrypt from '../src/crypto/scrypt.js'
import {base16, base58, base64, utf8} from '../src/util/encoding.js'
import assert from 'assert'

describe('scrypt', function () {
  it('match a known userId', function () {
    const password = 'william test'
    const result = 'TGnly9w3Fch7tyJVO+0MWLpvlbMGgWODf/tFlNkV6js='
    const snrp = scrypt.userIdSnrp

    return scrypt.scrypt(password, snrp).then(userId => {
      return assert.equal(base64.encode(userId), result)
    })
  })
})

describe('encryption', function () {
  it('decrypt existing data', function () {
    const key = base16.decode('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393')
    const box = {
      'data_base64': 'X08Snnou2PrMW21ZNyJo5C8StDjTNgMtuEoAJL5bJ6LDPdZGQLhjaUMetOknaPYnmfBCHNQ3ApqmE922Hkp30vdxzXBloopfPLJKdYwQxURYNbiL4TvNakP7i0bnTlIsR7bj1q/65ZyJOW1HyOKV/tmXCf56Fhe3Hcmb/ebsBF72FZr3jX5pkSBO+angK15IlCIiem1kPi6QmzyFtMB11i0GTjSS67tLrWkGIqAmik+bGqy7WtQgfMRxQNNOxePPSHHp09431Ogrc9egY3txnBN2FKnfEM/0Wa/zLWKCVQXCGhmrTx1tmf4HouNDOnnCgkRWJYs8FJdrDP8NZy4Fkzs7FoH7RIaUiOvosNKMil1CBknKremP6ohK7SMLGoOHpv+bCgTXcAeB3P4Slx3iy+RywTSLb3yh+HDo6bwt+vhujP0RkUamI5523bwz3/7vLO8BzyF6WX0By2s4gvMdFQ==',
      'encryptionType': 0,
      'iv_hex': '96a4cd52670c13df9712fdc1b564d44b'
    }

    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })

  it('round-trip data', function () {
    const key = base16.decode('002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393')
    const data = utf8.encode('payload')
    const box = crypto.encrypt(data, key)
    assert.equal('payload', crypto.decrypt(box, key).toString('utf8'))
  })
})

describe('hmac-sha256', function () {
  it('match a known hash', function () {
    const key = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    const data = new Uint8Array([0, 1, 2])
    const expected = 'DqkzMDMbhngmVUPhX3QL1n1zKmagPZcxWeBKvTSojYdH'

    assert.equal(expected, base58.encode(crypto.hmacSha256(data, key)))
  })
})

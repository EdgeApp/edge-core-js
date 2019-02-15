// @flow

import { assert } from 'chai'
import { describe, it } from 'mocha'
import { base16 } from 'rfc4648'

import { makeFakeIo } from '../../../src/index.js'
import {
  decrypt,
  encrypt,
  hmacSha256,
  sha256
} from '../../../src/util/crypto/crypto.js'
import { utf8 } from '../../../src/util/encoding.js'

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
    const io = makeFakeIo()
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
      'F7BC83F430538424B13298E6AA6FB143EF4D59A14946175997479DBC2D1A3CD8'

    assert.equal(expected, base16.stringify(hmacSha256(data, key)))
  })

  it('sha256', function () {
    const data = utf8.parse('This is a test')
    const expected =
      'C7BE1ED902FB8DD4D48997C6452F5D7E509FBCDBE2808B16BCF4EDCE4C07D14E'

    assert.equal(expected, base16.stringify(sha256(data)))
  })
})

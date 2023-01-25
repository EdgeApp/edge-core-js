import { assert } from 'chai'
import { describe, it } from 'mocha'
import { base16 } from 'rfc4648'

import { hmacSha256, sha256 } from '../../../src/util/crypto/hashes'
import { utf8 } from '../../../src/util/encoding'

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

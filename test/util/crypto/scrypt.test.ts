import { assert } from 'chai'
import { describe, it } from 'mocha'
import { base16, base64 } from 'rfc4648'

import { scrypt } from '../../../src/util/crypto/scrypt'
import { utf8 } from '../../../src/util/encoding'

describe('scrypt', function () {
  it('match a known userId', async function () {
    const password = utf8.parse('william test')
    const salt = base16.parse(
      'b5865ffb9fa7b3bfe4b2384d47ce831ee22a4a9d5c34c7ef7d21467cc758f81b'
    )
    const result = 'TGnly9w3Fch7tyJVO+0MWLpvlbMGgWODf/tFlNkV6js='

    const userId = await scrypt(password, salt, 16384, 1, 1, 32)
    assert.equal(base64.stringify(userId), result)
  })
})

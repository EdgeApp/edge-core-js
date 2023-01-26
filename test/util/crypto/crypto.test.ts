import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base16 } from 'rfc4648'

import { makeFakeIo } from '../../../src/index'
import { decrypt, decryptText, encrypt } from '../../../src/util/crypto/crypto'
import { utf8 } from '../../../src/util/encoding'

describe('encryption', function () {
  it('decrypts existing data', function () {
    const key = base16.parse(
      '002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393'
    )
    const box = {
      data_base64:
        'X08Snnou2PrMW21ZNyJo5C8StDjTNgMtuEoAJL5bJ6LDPdZGQLhjaUMetOknaPYnmfBCHNQ3ApqmE922Hkp30vdxzXBloopfPLJKdYwQxURYNbiL4TvNakP7i0bnTlIsR7bj1q/65ZyJOW1HyOKV/tmXCf56Fhe3Hcmb/ebsBF72FZr3jX5pkSBO+angK15IlCIiem1kPi6QmzyFtMB11i0GTjSS67tLrWkGIqAmik+bGqy7WtQgfMRxQNNOxePPSHHp09431Ogrc9egY3txnBN2FKnfEM/0Wa/zLWKCVQXCGhmrTx1tmf4HouNDOnnCgkRWJYs8FJdrDP8NZy4Fkzs7FoH7RIaUiOvosNKMil1CBknKremP6ohK7SMLGoOHpv+bCgTXcAeB3P4Slx3iy+RywTSLb3yh+HDo6bwt+vhujP0RkUamI5523bwz3/7vLO8BzyF6WX0By2s4gvMdFQ==',
      encryptionType: 0,
      iv_hex: '96a4cd52670c13df9712fdc1b564d44b'
    }

    expect(decrypt(box, key)).deep.equals(utf8.parse('payload'))
  })

  it('round-trips data', function () {
    const io = makeFakeIo()
    const key = base16.parse(
      '002688cc350a5333a87fa622eacec626c3d1c0ebf9f3793de3885fa254d7e393'
    )
    const data = utf8.parse('payload\0')
    const box = encrypt(io, data, key)
    expect(decryptText(box, key)).equals('payload')
  })
})

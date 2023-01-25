import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base16, base32 } from 'rfc4648'

import { hotp, numberToBe64 } from '../../../src/util/crypto/hotp'
import { utf8 } from '../../../src/util/encoding'

describe('hotp', function () {
  it('converts numbers to bytes', function () {
    const cases: Array<[number, string]> = [
      // Powers of 2, plus 1:
      [1, '0000000000000001'],
      [257, '0000000000000101'],
      [65537, '0000000000010001'],
      [16777217, '0000000001000001'],
      [4294967297, '0000000100000001'],
      [1099511627777, '0000010000000001'],
      [281474976710657, '0001000000000001'],
      [72057594037927937, '0100000000000000'], // eslint-disable-line no-loss-of-precision
      // The edge of the representable integers:
      [9007199254740991, '001FFFFFFFFFFFFF'],
      [9007199254740992, '0020000000000000'],
      [9007199254740993, '0020000000000000'], // eslint-disable-line no-loss-of-precision
      [9007199254740994, '0020000000000002'],
      // Fractions:
      [0.75, '0000000000000000'],
      [1.75, '0000000000000001'],
      // Negative numbers:
      [-1, 'FFFFFFFFFFFFFFFF'],
      [-256, 'FFFFFFFFFFFFFF00'],
      [-257, 'FFFFFFFFFFFFFEFF'],
      [-4294967296, 'FFFFFFFF00000000'],
      [-4294967297, 'FFFFFFFEFFFFFFFF'],
      [-9007199254740992, 'FFE0000000000000']
    ]
    for (const [number, hex] of cases) {
      expect(numberToBe64(number)).deep.equals(base16.parse(hex))
    }
  })

  it('Handles official rfc4226 test vectors', function () {
    const key = utf8.parse('12345678901234567890')
    const cases = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489'
    ]

    for (let i = 0; i < cases.length; ++i) {
      expect(hotp(key, i, 6)).equals(cases[i])
    }
  })

  it('Handles leading zeros in output', function () {
    const key = base32.parse('AAAAAAAA')
    expect(hotp(key, 2, 6)).equals('073348')
    expect(hotp(key, 9, 6)).equals('003773')
    expect(hotp(key, 41952, 6)).equals('048409')
  })
})

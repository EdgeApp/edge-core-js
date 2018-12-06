// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base16 } from 'rfc4648'

import { utf8 } from '../../src/util/encoding.js'

describe('encoding', function () {
  it('utf8', function () {
    const tests = [
      { string: 'ascii', data: '6173636969' },
      { string: 'テスト', data: 'E38386E382B9E38388' },
      { string: '😀', data: 'F09F9880' }
    ]

    for (const { string, data } of tests) {
      // utf8.parse:
      expect(base16.stringify(utf8.parse(string))).equals(data)

      // utf8.stringify:
      expect(utf8.stringify(base16.parse(data))).equals(string)

      // utf8.stringify with extra null byte:
      expect(utf8.stringify(base16.parse(data + '00'))).equals(string)
    }
  })
})

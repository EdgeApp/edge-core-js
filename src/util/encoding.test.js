// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { base16, utf8 } from './encoding.js'

describe('encoding', function () {
  it('utf8', function () {
    const tests = [
      { string: 'ascii', data: '6173636969' },
      { string: 'テスト', data: 'e38386e382b9e38388' },
      { string: '😀', data: 'f09f9880' }
    ]

    for (const { string, data } of tests) {
      // utf8.parse:
      expect(base16.stringify(utf8.parse(string))).to.equal(data)

      // utf8.stringify:
      expect(utf8.stringify(base16.parse(data))).to.equal(string)

      // utf8.stringify with extra null byte:
      expect(utf8.stringify(base16.parse(data + '00'))).to.equal(string)
    }
  })
})

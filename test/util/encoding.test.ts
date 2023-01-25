import { expect } from 'chai'
import { describe, it } from 'mocha'
import { base16 } from 'rfc4648'

import { utf8 } from '../../src/util/encoding'

describe('encoding', function () {
  it('utf8', function () {
    const tests = [
      { string: 'ascii', data: '6173636969' },
      { string: 'テスト', data: 'E38386E382B9E38388' },
      { string: '😀', data: 'F09F9880' }
    ]

    for (const { string, data } of tests) {
      const bytes = base16.parse(data)

      // utf8.parse:
      expect(utf8.parse(string)).deep.equals(bytes)

      // utf8.stringify:
      expect(utf8.stringify(bytes)).equals(string)
    }
  })
})

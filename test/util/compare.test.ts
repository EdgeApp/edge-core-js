import { expect } from 'chai'
import { describe, it } from 'mocha'

import { compare } from '../../src/util/compare'

describe('compare', function () {
  it('compare', function () {
    expect(compare(1, 2)).equals(false)
    expect(compare(1, '1')).equals(false)
    expect(compare(1, null)).equals(false)
    expect(compare({ a: 1 }, {})).equals(false)
    expect(compare({}, { a: 1 })).equals(false)
    expect(compare({ a: 1 }, { a: 2 })).equals(false)
    expect(compare([1, 2], [1])).equals(false)
    expect(compare([1, 2], [1, '2'])).equals(false)

    expect(compare(1, 1)).equals(true)
    expect(compare({ a: 1 }, { a: 1 })).equals(true)
    expect(compare([1, 2], [1, 2])).equals(true)
    expect(compare(new Date(20), new Date(20))).equals(true)
    expect(compare(new Map(), new Map())).equals(true)
    expect(
      compare(
        new Map([
          [null, 2],
          ['a', 2]
        ]),
        new Map([
          ['a', 2],
          [null, 2]
        ])
      )
    ).equals(true)
    expect(
      compare(
        new Map([
          [null, 1],
          ['a', 2]
        ]),
        new Map([
          ['a', 2],
          [null, 2]
        ])
      )
    ).equals(false)
  })
})

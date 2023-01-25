import { assert } from 'chai'
import { describe, it } from 'mocha'

import { compare } from '../../src/util/compare'

describe('compare', function () {
  it('compare', function () {
    assert(!compare(1, 2))
    assert(!compare(1, '1'))
    assert(!compare(1, null))
    assert(!compare({ a: 1 }, {}))
    assert(!compare({}, { a: 1 }))
    assert(!compare({ a: 1 }, { a: 2 }))
    assert(!compare([1, 2], [1]))
    assert(!compare([1, 2], [1, '2']))

    assert(compare(1, 1))
    assert(compare({ a: 1 }, { a: 1 }))
    assert(compare([1, 2], [1, 2]))
    assert(compare(new Date(20), new Date(20)))
  })
})

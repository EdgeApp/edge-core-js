// @flow

import { assert } from 'chai'
import { describe, it } from 'mocha'

import { compare, recycle } from './compare.js'

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

  it('recycle', function () {
    const a = {
      p1: 1,
      p2: 1,
      a1: [{ a: 1 }, { a: 2 }],
      a2: [{ a: 1 }, { a: 1 }],
      o1: { a: '1', b: '2' },
      o2: { a: '1', b: '1' }
    }
    const b = {
      p1: 1,
      p2: 2,
      a1: [{ a: 1 }, { a: 2 }],
      a2: [{ a: 1 }, { a: 2 }],
      o1: { a: '1', b: '2' },
      o2: { a: '1', b: '2' }
    }
    const c = recycle(a, b)

    assert.deepEqual(c, a)
    assert.equal(c.a1, b.a1)
    assert.equal(c.o1, b.o1)
    assert.equal(c.a2[0], b.a2[0])
  })
})

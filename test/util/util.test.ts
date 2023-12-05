import { expect } from 'chai'
import { describe, it } from 'mocha'

import { mergeDeeply, mergeDeeplyNull } from '../../src/util/util'

describe('utilities', function () {
  it('mergeDeeply', function () {
    const a = {
      x: 1,
      y: { a: -1, c: 4 }
    }
    const b = {
      y: { a: 2, b: 3 },
      z: 5
    }

    expect(mergeDeeply(a, b)).deep.equals({
      x: 1,
      y: { a: 2, b: 3, c: 4 },
      z: 5
    })
  })
  it('mergeDeeplyNull', function () {
    const a = {
      x: 1,
      y: { a: -1, c: 4 }
    }
    const b = {
      x: null,
      y: { a: 2, b: 3 },
      z: 5
    }

    expect(mergeDeeplyNull(a, b)).deep.equals({
      x: null,
      y: { a: 2, b: 3, c: 4 },
      z: 5
    })
  })
})

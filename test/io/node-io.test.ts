import { expect } from 'chai'
import { describe, it } from 'mocha'
import { resolve } from 'path'

import { makeNodeIo } from '../../src/index'

describe('makeNodeIo', function () {
  it('exposes the resolved context path', function () {
    const io = makeNodeIo('/tmp/edge-io-path')
    expect(io.path).to.equal(resolve('/tmp/edge-io-path'))
  })
})

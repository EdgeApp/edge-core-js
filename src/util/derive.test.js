/* global describe, it */
import { makeAssertLog } from '../test/assertLog.js'
import { deriveSelector } from './derive.js'
import assert from 'assert'

describe('derive', function () {
  it('basic operation', function () {
    const log = makeAssertLog()

    const state1 = [1, 10]
    const state2 = [2, 10]
    const state3 = [2, 20]

    const selector = deriveSelector(
      (state, index) => [state[index], index],
      (value, index) => {
        log(index, value)
        return value * 2
      }
    )

    // Nothing should run yet:
    log.assert([])

    // Each selector should run once:
    assert.equal(selector(state1, 0), 2)
    assert.equal(selector(state1, 1), 20)
    assert.equal(selector(state1, 0), 2)
    assert.equal(selector(state1, 1), 20)
    log.assert(['0 1', '1 10'])

    // Only the first index should run:
    assert.equal(selector(state2, 0), 4)
    assert.equal(selector(state2, 1), 20)
    log.assert(['0 2'])

    // Only the second index should run:
    assert.equal(selector(state3, 0), 4)
    assert.equal(selector(state3, 1), 40)
    log.assert(['1 20'])
  })
})

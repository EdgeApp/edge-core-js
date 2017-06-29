/* global describe, it */
import { deriveSelector } from '../src/util/derive.js'
import assert from 'assert'

describe('derive', function () {
  it('basic operation', function () {
    // Logs which functions were called:
    let log = []
    function assertLog (ref) {
      assert.deepEqual(log, ref)
      log = []
    }

    const state1 = [1, 10]
    const state2 = [2, 10]
    const state3 = [2, 20]

    const selector = deriveSelector(
      (state, index) => [state[index], index],
      (value, index) => {
        log.push(`${index}, ${value}`)
        return value * 2
      }
    )

    // Nothing should run yet:
    assertLog([])

    // Each selector should run once:
    assert.equal(selector(state1, 0), 2)
    assert.equal(selector(state1, 1), 20)
    assert.equal(selector(state1, 0), 2)
    assert.equal(selector(state1, 1), 20)
    assertLog(['0, 1', '1, 10'])

    // Only the first index should run:
    assert.equal(selector(state2, 0), 4)
    assert.equal(selector(state2, 1), 20)
    assertLog(['0, 2'])

    // Only the second index should run:
    assert.equal(selector(state3, 0), 4)
    assert.equal(selector(state3, 1), 40)
    assertLog(['1, 20'])
  })
})

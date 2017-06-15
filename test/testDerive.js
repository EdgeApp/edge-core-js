/* global describe, it */
import { makeStore, makeComputed, makeReaction } from '../src/util/derive.js'
import assert from 'assert'

describe('derive', function () {
  it('basic operation', function () {
    const disposers = []

    // Logs which functions were called:
    let log = []
    function assertLog (ref) {
      assert.deepEqual(log.sort(), ref)
      log = []
    }

    // Stores:
    const count = makeStore(0)
    const wantOdd = makeStore(true)

    // Computed values:
    const isOdd = makeComputed(() => {
      const out = (count() & 1) === 1
      log.push(`isOdd: ${out}`)
      return out
    })
    const isGood = makeComputed(() => {
      const out = isOdd() === wantOdd()
      log.push(`isGood: ${out}`)
      return out
    })
    const double = makeComputed(() => {
      const out = count() * 2
      log.push(`double: ${out}`)
      return out
    })

    // Reactions:
    disposers.push(
      makeReaction(() => {
        log.push(`react to goodness: ${isGood()}`)
      })
    )
    disposers.push(
      makeReaction(() => {
        log.push(`react to oddness: ${isOdd()}`)
      })
    )
    disposers.push(
      makeReaction(() => {
        log.push(`react to count & double: ${count()} ${double()}`)
      })
    )

    // Everything runs once to start:
    assertLog([
      'double: 0',
      'isGood: false',
      'isOdd: false',
      'react to count & double: 0 0',
      'react to goodness: false',
      'react to oddness: false'
    ])

    // This should change everything:
    count.set(1)
    assertLog([
      'double: 2',
      'isGood: true',
      'isOdd: true',
      'react to count & double: 1 2',
      'react to goodness: true',
      'react to oddness: true'
    ])

    // Stay odd, so only count-related stuff should run:
    count.set(3)
    assertLog(['double: 6', 'isOdd: true', 'react to count & double: 3 6'])

    // This will change everything again:
    count.set(2)
    assertLog([
      'double: 4',
      'isGood: false',
      'isOdd: false',
      'react to count & double: 2 4',
      'react to goodness: false',
      'react to oddness: false'
    ])

    // Toggle goodness, leaving count and oddness unchanged.
    // This also checks multi-store dependencies:
    wantOdd.set(false)
    assertLog(['isGood: true', 'react to goodness: true'])

    // We are still even, so only count-related stuff should change:
    count.set(4)
    assertLog(['double: 8', 'isOdd: false', 'react to count & double: 4 8'])

    disposers.forEach(disposer => disposer())
  })

  it('safe recursive setting', function () {
    let reactionCount = 0

    const store = makeStore(0)
    const isOdd = makeComputed(() => store() % 2)
    const disposer = makeReaction(() => {
      ++reactionCount
      isOdd()
      store.set(2) // Still odd, so we shouldn't run
    })

    assert.equal(reactionCount, 1)
    disposer()
  })
})

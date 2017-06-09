/* global describe, it */
import {
  makeStore,
  makeComputed,
  makeReaction,
  reduxSource
} from '../src/util/derive.js'
import assert from 'assert'
import { createStore } from 'redux'

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

  it('redux connection', function () {
    const disposers = []

    // Logs which functions were called:
    let log = []
    function assertLog (ref) {
      assert.deepEqual(log.sort(), ref)
      log = []
    }

    // Redux store:
    function reducer (state = { count: 1, toggle: false }, action) {
      switch (action.type) {
        case 'ADD':
          return { ...state, count: state.count + action.delta }
        case 'TOGGLE':
          return { ...state, toggle: !state.toggle }
        default:
          return state
      }
    }
    const store = createStore(reducer, void 0, reduxSource())

    // Computed values:
    const count = makeComputed(() => {
      const { count } = store.getState()
      log.push(`count: ${count}`)
      return count
    })
    const double = makeComputed(() => {
      const double = count() * 2
      log.push(`double: ${double}`)
      return double
    })
    const toggle = makeComputed(() => {
      const { toggle } = store.getState()
      log.push(`toggle: ${toggle}`)
      return toggle
    })

    // Reactions:
    disposers.push(
      makeReaction(() => {
        log.push(`react to double: ${double()}`)
      })
    )
    disposers.push(
      makeReaction(() => {
        log.push(`react to toggle: ${toggle()}`)
      })
    )

    // Everything runs once to start:
    assertLog([
      'count: 1',
      'double: 2',
      'react to double: 2',
      'react to toggle: false',
      'toggle: false'
    ])

    // Changing the count should trigger the count reaction:
    store.dispatch({ type: 'ADD', delta: 2 })
    assertLog(['count: 3', 'double: 6', 'react to double: 6', 'toggle: false'])

    // Leaving the count unafected shouldn't trigger any reactions:
    store.dispatch({ type: 'ADD', delta: 0 })
    assertLog(['count: 3', 'toggle: false'])

    // Changing the toggle shouldn't affect the reaction,
    // but the count still needs to run to see that nothing has changed:
    store.dispatch({ type: 'TOGGLE' })
    assertLog(['count: 3', 'react to toggle: true', 'toggle: true'])

    disposers.forEach(disposer => disposer())
  })
})

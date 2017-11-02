import { assert } from 'chai'
import { describe, it } from 'mocha'
import { applyMiddleware, combineReducers, createStore } from 'redux'

import { makeAssertLog } from '../assertLog.js'
import { awaitState, createReaction, reactionMiddleware } from './reaction.js'

describe('redux-reactions', function () {
  it('basic operations', function () {
    const log = makeAssertLog(true)

    // Reducers:
    const count = (state = 1, action) =>
      action.type === 'ADD' ? state + action.payload : state

    const toggle = (state = false, action) =>
      action.type === 'TOGGLE' ? !state : state

    const double = (state = 0, action) =>
      action.type === 'SET_DOUBLE' ? action.payload : state

    const reducer = combineReducers({
      count,
      double,
      toggle
    })

    // Redux store:
    const store = createStore(reducer, applyMiddleware(reactionMiddleware))

    // Add reactions:
    store.dispatch(createReaction(state => state.toggle, () => log('toggle')))
    const disposeDouble = store.dispatch(
      createReaction(
        state => state.count,
        count => dispatch => {
          log('double')
          dispatch({ type: 'SET_DOUBLE', payload: 2 * count })
        }
      )
    )

    // The reactions should run once to start:
    log.assert(['double', 'toggle'])
    assert.equal(store.getState().double, 2)

    // Changing the count should trigger the double calculation:
    store.dispatch({ type: 'ADD', payload: 2 })
    log.assert(['double'])
    assert.equal(store.getState().double, 6)

    // Changing the toggle should not affect the count:
    store.dispatch({ type: 'TOGGLE' })
    log.assert(['toggle'])

    // Switch off the double reaction:
    store.dispatch(disposeDouble)

    // Changing the count should not trigger the double calculation:
    store.dispatch({ type: 'ADD', payload: -2 })
    log.assert([])
    assert.equal(store.getState().double, 6)

    // The toggle reaction should still be active:
    store.dispatch({ type: 'TOGGLE' })
    log.assert(['toggle'])
  })

  it('can await redux states', async function () {
    const reducer = (state = false, action) =>
      action.type === 'TOGGLE' ? !state : state
    const store = createStore(reducer)
    const promise = awaitState(store, state => state)

    // The promise should start off pending:
    let triggered = false
    promise.then(() => {
      triggered = true
      return null
    })
    assert(!triggered)

    // Trigger the transition:
    store.dispatch({ type: 'TOGGLE' })

    // The promise should resolve now:
    await promise
    assert(triggered)
  })

  it('can await redux states that are already true', async function () {
    const reducer = (state = true, action) => state
    const store = createStore(reducer)
    await awaitState(store, state => state)
  })
})

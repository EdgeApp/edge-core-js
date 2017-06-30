/* global describe, it */
import { reactionMiddleware, createReaction } from '../src/util/reaction.js'
import { makeAssertLog } from './fake/assertLog.js'
import assert from 'assert'
import { applyMiddleware, combineReducers, createStore } from 'redux'

describe('redux-reactions', function () {
  it('basic operations', function () {
    const log = makeAssertLog(true)

    // Reducers:
    const count = (state = 1, action) =>
      (action.type === 'ADD' ? state + action.payload : state)

    const toggle = (state = false, action) =>
      (action.type === 'TOGGLE' ? !state : state)

    const double = (state = 0, action) =>
      (action.type === 'SET_DOUBLE' ? action.payload : state)

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
})

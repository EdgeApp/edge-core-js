/* global describe, it */
import { reactionMiddleware, createReaction } from '../src/util/reaction.js'
import assert from 'assert'
import { applyMiddleware, combineReducers, createStore } from 'redux'

describe('redux-reactions', function () {
  it('basic operations', function () {
    // Logs which functions were called:
    let doubleCount = 0
    let toggleCount = 0

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
    store.dispatch(createReaction(state => state.toggle, () => ++toggleCount))
    const disposeDouble = store.dispatch(
      createReaction(
        state => state.count,
        count => dispatch => {
          ++doubleCount
          dispatch({ type: 'SET_DOUBLE', payload: 2 * count })
        }
      )
    )

    // The reactions should run once to start:
    assert.equal(store.getState().double, 2)
    assert.equal(doubleCount, 1)
    assert.equal(toggleCount, 1)

    // Changing the count should trigger the double calculation:
    store.dispatch({ type: 'ADD', payload: 2 })
    assert.equal(store.getState().double, 6)
    assert.equal(doubleCount, 2)
    assert.equal(toggleCount, 1)

    // Changing the toggle should not affect the count:
    store.dispatch({ type: 'TOGGLE' })
    assert.equal(store.getState().double, 6)
    assert.equal(doubleCount, 2)
    assert.equal(toggleCount, 2)

    // Switch off the reaction:
    store.dispatch(disposeDouble)

    // Changing the count should not trigger the double calculation:
    store.dispatch({ type: 'ADD', payload: -2 })
    assert.equal(store.getState().double, 6)
    assert.equal(doubleCount, 2)
    assert.equal(toggleCount, 2)

    // The toggle reaction should still be active:
    store.dispatch({ type: 'TOGGLE' })
    assert.equal(toggleCount, 3)
  })
})

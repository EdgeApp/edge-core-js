import { assert as chaiAssert } from 'chai'

function stringify (...args) {
  return args
    .map(arg => {
      if (arg == null) return typeof arg
      if (typeof arg !== 'object') return arg.toString()
      return JSON.stringify(arg)
    })
    .join(' ')
}

/**
 * Asserts that the correct events have occurred.
 * Used for testing callbacks.
 */
export function makeAssertLog (sort = false) {
  let events = []

  const out = function log (...args) {
    events.push(stringify(...args))
  }

  out.assert = function assert (expected) {
    sort
      ? chaiAssert.deepEqual(events.sort(), expected.sort())
      : chaiAssert.deepEqual(events, expected)
    events = []
  }

  return out
}

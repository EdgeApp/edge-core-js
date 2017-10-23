// @flow
import { assert as chaiAssert } from 'chai'

function stringify (...args: Array<mixed>) {
  return args
    .map(arg => {
      if (arg == null) return typeof arg
      if (typeof arg !== 'object') return (arg: any).toString()
      return JSON.stringify(arg)
    })
    .join(' ')
}

/**
 * Asserts that the correct events have occurred.
 * Used for testing callbacks.
 */
export function makeAssertLog (sort: boolean = false) {
  let events: Array<string> = []

  const out = function log (...args: Array<mixed>) {
    events.push(stringify(...args))
  }

  out.assert = function assert (expected: Array<string>) {
    sort
      ? chaiAssert.deepEqual(events.sort(), expected.sort())
      : chaiAssert.deepEqual(events, expected)
    events = []
  }

  return out
}

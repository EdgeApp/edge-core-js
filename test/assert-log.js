// @flow

import { expect } from 'chai'

/**
 * Asserts that a correct sequence of events have occurred.
 * Used for testing callbacks.
 *
 * To log an event, call this function with a string describing the event.
 * Then, to verify that everything is correct, call the `assert` method
 * with an array of expected log strings. If there is a mis-match,
 * `assert` will throw an exception.
 */
export type AssertLog = {
  assert(Array<string>): void
} & ((...args: Array<any>) => void)

function stringify (...args: Array<any>) {
  return args
    .map(arg => {
      if (arg == null) return typeof arg
      if (typeof arg !== 'object') return arg.toString()
      return JSON.stringify(arg)
    })
    .join(' ')
}

/**
 * Creates an object that can assert that the correct events have occurred.
 * Used for testing callbacks.
 * @param sort True to ignore the order of events.
 * @param verbose True to also send all logged events to the console.
 */
export function makeAssertLog (
  sort: boolean = false,
  verbose: boolean = false
): AssertLog {
  let events: Array<string> = []

  const out: any = function log (...args: Array<any>) {
    const event = stringify(...args)
    if (verbose) console.log(event)
    events.push(event)
  }

  out.assert = function assert (expected: Array<string>) {
    sort
      ? expect(events.sort()).to.deep.equal(expected.sort())
      : expect(events).to.deep.equal(expected)
    events = []
  }

  return out
}

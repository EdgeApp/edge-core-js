// @flow

import { expect } from 'chai'

/**
 * Verifies that a promise rejects with a particular error.
 */
export function expectRejection(
  promise: Promise<mixed>,
  message?: string
): Promise<void> {
  return promise.then(
    ok => {
      throw new Error('Expecting this promise to reject')
    },
    error => {
      if (message != null) expect(String(error)).equals(message)
    }
  )
}

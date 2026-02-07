import { expect } from 'chai'
import { describe, it } from 'mocha'

import { fuzzyTimeout } from '../../src/util/promise'
import { snooze } from '../../src/util/snooze'
import { expectRejection } from '../expect-rejection'

describe('promise', function () {
  it('fuzzyTimeout resolves', async function () {
    expect(await fuzzyTimeout([snooze(1), snooze(20)], 10)).deep.equals({
      results: [1],
      errors: []
    })
    expect(await fuzzyTimeout([snooze(1), snooze(2)], 10)).deep.equals({
      results: [1, 2],
      errors: []
    })
    expect(await fuzzyTimeout([snooze(20), snooze(30)], 10)).deep.equals({
      results: [20],
      errors: []
    })

    const error = new Error('Expected')
    const data = [snooze(1), Promise.reject(error), snooze(1000)]
    expect(await fuzzyTimeout(data, 10)).deep.equals({
      results: [1],
      errors: [error]
    })

    await expectRejection(
      fuzzyTimeout([Promise.reject(error), Promise.reject(error)], 10),
      'Error: Expected,Error: Expected'
    )
  })

  it('fuzzyTimeout does not reject early on post-timeout errors', async function () {
    // After the timer fires with no results, a late error should not
    // cause rejection while a successful promise is still pending:
    const error = new Error('Expected')
    // eslint-disable-next-line promise/param-names
    const delayedReject = new Promise<number>((_resolve, reject) =>
      setTimeout(() => reject(error), 15)
    )
    expect(await fuzzyTimeout([delayedReject, snooze(20)], 10)).deep.equals({
      results: [20],
      errors: [error]
    })
  })
})

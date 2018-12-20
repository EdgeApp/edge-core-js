// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { fuzzyTimeout } from '../../src/util/promise.js'
import { expectRejection } from '../expect-rejection.js'
import { snooze } from '../snooze.js'

describe('promise', function () {
  it('fuzzyTimeout resolves', async function () {
    expect(await fuzzyTimeout([snooze(1), snooze(20)], 10)).deep.equals([1])
    expect(await fuzzyTimeout([snooze(1), snooze(2)], 10)).deep.equals([1, 2])
    expect(await fuzzyTimeout([snooze(20), snooze(30)], 10)).deep.equals([20])

    const data = [snooze(1), Promise.reject(new Error()), snooze(1000)]
    expect(await fuzzyTimeout(data, 10)).deep.equals([1])

    const fail = Promise.reject(new Error('Expected'))
    await expectRejection(
      fuzzyTimeout([fail, fail], 10),
      'Error: Expected,Error: Expected'
    )
  })
})

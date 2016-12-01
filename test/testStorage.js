/* global describe, it */
import assert from 'assert'

import {FakeStorage} from './fake/fakeStorage.js'
import {ScopedStorage} from '../src/util/scopedStorage.js'

describe('storage', function () {
  it('enumerate keys', function () {
    const localStorage = new FakeStorage()
    localStorage.setItem('scope.a', 'a')
    localStorage.setItem('scope.b', 'b')
    localStorage.setItem('scope.a.c', 'a.c')
    localStorage.setItem('scope', 'nope')

    const scopedStorage = new ScopedStorage(localStorage, 'scope')
    assert.deepEqual(scopedStorage.keys().sort(), [
      'a', 'a.c', 'b'
    ])
  })
})

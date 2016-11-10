/* global describe, it */
var assert = require('assert')
var FakeStorage = require('./fake/fakeStorage.js').FakeStorage
var ScopedStorage = require('../src/util/scopedStorage.js').ScopedStorage

describe('storage', function () {
  it('enumerate keys', function () {
    var localStorage = new FakeStorage()
    localStorage.setItem('scope.a', 'a')
    localStorage.setItem('scope.b', 'b')
    localStorage.setItem('scope.a.c', 'a.c')
    localStorage.setItem('scope', 'nope')

    var scopedStorage = new ScopedStorage(localStorage, 'scope')
    assert.deepEqual(scopedStorage.keys().sort(), [
      'a', 'a.c', 'b'
    ])
  })
})

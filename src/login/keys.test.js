/* global describe, it */
import { mergeKeyInfos } from './keys.js'
import assert from 'assert'

const ID_1 = 'PPptx6SBfwGXM+FZURMvYnsOfHpIKZBbqXTCbYmFd44='
const ID_2 = 'y14MYFMP6vnip2hUBP7aqB6Ut0d4UNqHV9a/2vgE9eQ='

describe('mergeKeyInfos', function () {
  it('merge separate keys', function () {
    const key1 = { id: ID_1, type: 'foo', keys: { a: 1 } }
    const key2 = { id: ID_2, type: 'bar', keys: { a: 2 } }
    const out = mergeKeyInfos([key1, key2])

    assert.equal(out.length, 2)
    assert.deepEqual(out[0], key1)
    assert.deepEqual(out[1], key2)
  })

  it('merge overlapping keys', function () {
    const key1 = { id: ID_1, type: 'foo', keys: { a: 1 } }
    const key2 = { id: ID_1, type: 'foo', keys: { b: 2 } }
    const key3 = { id: ID_1, type: 'foo', keys: { a: 1, b: 2 } }
    const out = mergeKeyInfos([key1, key2])

    assert.equal(out.length, 1)
    assert.deepEqual(out[0], key3)
    assert.deepEqual(key1.keys, { a: 1 })
    assert.deepEqual(key2.keys, { b: 2 })
  })

  it('merge conflicting types', function () {
    assert.throws(() =>
      mergeKeyInfos([
        { id: ID_1, type: 'foo', keys: { a: 1 } },
        { id: ID_1, type: 'bar', keys: { b: 2 } }
      ])
    )
  })

  it('merge conflicting keys', function () {
    assert.throws(() =>
      mergeKeyInfos([
        { id: ID_1, type: 'foo', keys: { a: 1 } },
        { id: ID_1, type: 'foo', keys: { a: 2 } }
      ])
    )
  })
})

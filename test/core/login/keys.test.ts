import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import {
  fixWalletInfo,
  makeSplitWalletInfo,
  mergeKeyInfos
} from '../../../src/core/login/keys'

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

describe('fixWalletInfo', function () {
  it('handles legacy keys', function () {
    expect(
      fixWalletInfo({
        id: 'id',
        keys: { bitcoinKey: 'bitcoinKey' },
        type: 'wallet:bitcoin'
      })
    ).deep.equals({
      id: 'id',
      keys: { bitcoinKey: 'bitcoinKey', format: 'bip32' },
      type: 'wallet:bitcoin'
    })

    expect(
      fixWalletInfo({
        id: 'id',
        keys: { bitcoinKey: 'bitcoinKey' },
        type: 'wallet:bitcoin-bip44-testnet'
      })
    ).deep.equals({
      id: 'id',
      keys: { bitcoinKey: 'bitcoinKey', format: 'bip44', coinType: 1 },
      type: 'wallet:bitcoin-testnet'
    })
  })

  it('leaves modern formats unchanged', function () {
    expect(
      fixWalletInfo({
        id: 'id',
        keys: { bitcoinKey: 'bitcoinKey', format: 'bip32' },
        type: 'wallet:bitcoin'
      })
    ).deep.equals({
      id: 'id',
      keys: { bitcoinKey: 'bitcoinKey', format: 'bip32' },
      type: 'wallet:bitcoin'
    })

    expect(
      fixWalletInfo({
        id: 'id',
        keys: {
          bitcoinKey: 'bitcoinKey',
          format: 'bip44',
          coinType: 145 // Split from BCH
        },
        type: 'wallet:bitcoin'
      })
    ).deep.equals({
      id: 'id',
      keys: { bitcoinKey: 'bitcoinKey', format: 'bip44', coinType: 145 },
      type: 'wallet:bitcoin'
    })
  })
})

describe('splitWalletInfo', function () {
  it('handles bitcoin to bitcoin cash', function () {
    expect(
      makeSplitWalletInfo(
        fixWalletInfo({
          id: 'MPo9EF5krFQNYkxn2I0elOc0XPbs2x7GWjSxtb5c1WU=',
          type: 'wallet:bitcoin',
          keys: {
            bitcoinKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
            dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
            syncKey: 'u8EIdKgxEG8j7buEt96Mq9usQ+k='
          }
        }),
        'wallet:bitcoincash'
      )
    ).deep.equals({
      id: 'SEsXNQxGL/D+8/vsBHJgwf7bAK6/OyR2BfescT7u/i4=',
      type: 'wallet:bitcoincash',
      keys: {
        bitcoincashKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
        dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
        syncKey: 'w3AiUfoTk8vQfAwPayHy/sJDH7E=',
        format: 'bip32'
      }
    })
  })

  it('handles bitcoin cash to bitcoin', function () {
    expect(
      makeSplitWalletInfo(
        {
          id: 'MPo9EF5krFQNYkxn2I0elOc0XPbs2x7GWjSxtb5c1WU=',
          type: 'wallet:bitcoincash',
          keys: {
            bitcoincashKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
            dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
            syncKey: 'u8EIdKgxEG8j7buEt96Mq9usQ+k=',
            format: 'bip44',
            coinType: 145
          }
        },
        'wallet:bitcoin'
      )
    ).deep.equals({
      id: 'SEsXNQxGL/D+8/vsBHJgwf7bAK6/OyR2BfescT7u/i4=',
      type: 'wallet:bitcoin',
      keys: {
        bitcoinKey: '6p2cW62FeO1jQrbex/oTJ8R856bEnpZqPYxiRYV4fL8=',
        dataKey: 'zm6w4Q0mNpeZJXrhYRoXiiV2xgONxvmq2df42/2M40A=',
        syncKey: 'w3AiUfoTk8vQfAwPayHy/sJDH7E=',
        format: 'bip44',
        coinType: 145
      }
    })
  })
})

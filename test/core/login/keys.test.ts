import { expect } from 'chai'
import { describe, it } from 'mocha'

import { fixWalletInfo, mergeKeyInfos } from '../../../src/core/login/keys'

const ID_1 = 'PPptx6SBfwGXM+FZURMvYnsOfHpIKZBbqXTCbYmFd44='
const ID_2 = 'y14MYFMP6vnip2hUBP7aqB6Ut0d4UNqHV9a/2vgE9eQ='

describe('mergeKeyInfos', function () {
  it('merge separate keys', function () {
    const key1 = { id: ID_1, type: 'foo', keys: { a: 1 } }
    const key2 = { id: ID_2, type: 'bar', keys: { a: 2 } }
    const out = mergeKeyInfos([key1, key2])

    expect(out.length).equals(2)
    expect(out[0]).deep.equals(key1)
    expect(out[1]).deep.equals(key2)
  })

  it('merge overlapping keys', function () {
    const key1 = { id: ID_1, type: 'foo', keys: { a: 1 } }
    const key2 = { id: ID_1, type: 'foo', keys: { b: 2 } }
    const key3 = { id: ID_1, type: 'foo', keys: { a: 1, b: 2 } }
    const out = mergeKeyInfos([key1, key2])

    expect(out.length).equals(1)
    expect(out[0]).deep.equals(key3)
    expect(key1.keys).deep.equals({ a: 1 })
    expect(key2.keys).deep.equals({ b: 2 })
  })

  it('merge conflicting types', function () {
    expect(() =>
      mergeKeyInfos([
        { id: ID_1, type: 'foo', keys: { a: 1 } },
        { id: ID_1, type: 'bar', keys: { b: 2 } }
      ])
    ).throws('Key integrity violation')
  })

  it('merge conflicting keys', function () {
    expect(() =>
      mergeKeyInfos([
        { id: ID_1, type: 'foo', keys: { a: 1 } },
        { id: ID_1, type: 'foo', keys: { a: 2 } }
      ])
    ).throws('Key integrity violation')
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

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { asEdgeTx, wasEdgeTx } from '../../../src/core/db/tx-cleaners'
import { fromEdgeTx, toEdgeTx, txAssets } from '../../../src/core/db/tx-convert'
import { EdgeTransaction, EdgeTx } from '../../../src/types/types'

/**
 * `EdgeTx`, its JSON boundary and its converters.
 *
 * `EdgeTx` *is* the `tx_chain` document, so the cleaner is the only thing
 * standing between a plugin's object and what the schema's generated columns
 * and triggers will read. Two of its checks -- the date and the amounts --
 * exist because the failure downstream is silent rather than loud.
 */

const uint256Max =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935'

function makeTx(overrides: Partial<EdgeTx> = {}): EdgeTx {
  return {
    walletId: 'W1',
    txid: 'tx1',
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 800000,
    isSend: true,
    nativeAmounts: new Map([[null, '-100']]),
    networkFees: new Map([[null, '10']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map(),
    ...overrides
  }
}

describe('EdgeTx cleaner', function () {
  it('spells the chain asset as an empty key in JSON', function () {
    const json: any = wasEdgeTx(
      makeTx({
        nativeAmounts: new Map([
          [null, '-100'],
          ['abc', '50']
        ])
      })
    )

    // `EdgeTokenId` is `string | null`, and an object key cannot be null --
    // JavaScript would coerce it to the string 'null', which is a real token
    // id as far as anything reading it back is concerned.
    expect(json.nativeAmounts).deep.equals({ '': '-100', abc: '50' })
  })

  it('round-trips through JSON', function () {
    const tx = makeTx({
      nativeAmounts: new Map([
        [null, '-100'],
        ['abc', uint256Max]
      ]),
      networkFees: new Map([[null, '2100']]),
      ourReceiveAddresses: ['bc1qexample'],
      memos: [{ type: 'text', value: 'hello', hidden: false }],
      tokenData: new Map([
        [null, { metadata: { name: 'Alice', notes: 'rent' } }],
        ['abc', { metadata: { category: 'Income:Salary' } }]
      ]),
      deviceDescription: 'iPhone'
    })

    // Through real JSON text, since that is what the document holds. The
    // document is what has to survive, so compare documents -- the cleaned
    // object also carries an explicit `undefined` for every absent optional.
    const json = JSON.parse(JSON.stringify(wasEdgeTx(tx)))
    const back = asEdgeTx(json)
    expect(JSON.parse(JSON.stringify(wasEdgeTx(back)))).deep.equals(json)

    // And the keyed fields come back as `Map`s, with `null` restored. The
    // round trip through JSON drops the explicit `undefined`s a cleaner adds
    // for absent optionals, which are not a difference in the data.
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
    expect(strip([...back.nativeAmounts])).deep.equals(
      strip([...tx.nativeAmounts])
    )
    expect(strip([...back.networkFees])).deep.equals([...tx.networkFees])
    expect(strip([...back.tokenData])).deep.equals(strip([...tx.tokenData]))
    expect(strip(back.memos)).deep.equals(tx.memos)
  })

  it('keeps 256-bit amounts exact', function () {
    // The reason amounts are strings all the way down: this does not fit a
    // JavaScript number, and parsing it would drop digits without failing.
    const tx = asEdgeTx(
      JSON.parse(
        JSON.stringify(
          wasEdgeTx(makeTx({ nativeAmounts: new Map([[null, uint256Max]]) }))
        )
      )
    )
    expect(tx.nativeAmounts.get(null)).equals(uint256Max)
  })

  it('refuses an amount that is not an integer', function () {
    for (const bad of ['1.5', '1e18', '', 'abc', '0x10']) {
      expect(
        () =>
          asEdgeTx({
            ...(wasEdgeTx(makeTx()) as object),
            nativeAmounts: { '': bad }
          }),
        `"${bad}" should be refused`
      ).throws()
    }
  })

  it('refuses a date SQLite could not read', function () {
    // `tx_chain.date` is a generated column over `unixepoch()` of this, and
    // `tx_asset_idx.effective_date` is NOT NULL -- so a bad date would fail
    // the insert from inside a trigger, naming neither the field nor the
    // transaction.
    expect(() =>
      asEdgeTx({
        ...(wasEdgeTx(makeTx()) as object),
        date: 'last tuesday'
      })
    ).throws()
  })

  it('does not store confirmations', function () {
    // Derived from the wallet's current height, so storing it would stale
    // every transaction in a wallet each time a block arrives.
    const json = wasEdgeTx(makeTx({ confirmations: 'confirmed' })) as object
    expect('confirmations' in json).equals(false)
  })
})

describe('EdgeTx converters', function () {
  const legacy: EdgeTransaction = {
    tokenId: null,
    currencyCode: 'BTC',
    nativeAmount: '-100',
    networkFees: [{ tokenId: null, nativeAmount: '10' }],
    networkFee: '10',
    blockHeight: 800000,
    date: 1717243200,
    txid: 'tx1',
    signedTx: 'deadbeef',
    memos: [],
    ourReceiveAddresses: ['bc1qexample'],
    isSend: true,
    walletId: 'W1',
    metadata: { name: 'Alice' }
  }

  it('widens one asset into a whole transaction', function () {
    const tx = toEdgeTx(legacy, 'bitcoin')

    expect(tx.pluginId).equals('bitcoin')
    expect(tx.date).equals('2024-06-01T12:00:00.000Z')
    expect([...tx.nativeAmounts]).deep.equals([[null, '-100']])
    expect([...tx.networkFees]).deep.equals([[null, '10']])
    expect(tx.tokenData.get(null)?.metadata).deep.equals({ name: 'Alice' })
  })

  it('projects a whole transaction back onto one asset', function () {
    expect(fromEdgeTx(toEdgeTx(legacy, 'bitcoin'), null, 'BTC')).deep.equals(
      legacy
    )
  })

  it('collects the params this device asked for', function () {
    const tx = toEdgeTx(
      { ...legacy, networkFeeOption: 'high', requestedCustomFee: { sat: 20 } },
      'bitcoin'
    )
    expect(tx.makeTxParams?.networkFeeOption).equals('high')

    // Absent entirely for a transaction we only observed, so a reader can
    // tell "we made this" from "we saw this":
    expect(toEdgeTx(legacy, 'bitcoin').makeTxParams).equals(undefined)
  })

  it('drops otherParams', function () {
    // Deliberate: it is free-form and plugin-controlled, and a swept UTXO
    // transaction carries private keys in it.
    const tx = toEdgeTx(
      { ...legacy, otherParams: { edgeSpendInfo: { privateKeys: ['L1aW'] } } },
      'bitcoin'
    )
    expect(JSON.stringify(tx)).does.not.include('L1aW')
  })

  it('names every asset a transaction touched', function () {
    // A token transfer moves the token and pays its fee in the chain's own
    // asset, so neither map alone names both.
    const tx = makeTx({
      nativeAmounts: new Map([['abc', '50']]),
      networkFees: new Map([[null, '2100']])
    })
    expect(new Set(txAssets(tx))).deep.equals(new Set([null, 'abc']))
  })

  it('reads a fee-only asset as a zero amount', function () {
    const tx = makeTx({
      nativeAmounts: new Map([['abc', '50']]),
      networkFees: new Map([[null, '2100']])
    })
    const legacy = fromEdgeTx(tx, null, 'BTC')
    expect(legacy.nativeAmount).equals('0')
    expect(legacy.networkFee).equals('2100')
  })

  it('fills the deprecated parent fee for a token', function () {
    const tx = makeTx({
      nativeAmounts: new Map([['abc', '50']]),
      networkFees: new Map([[null, '2100']])
    })
    const token = fromEdgeTx(tx, 'abc', 'USDC')
    expect(token.networkFee).equals('0')
    expect(token.parentNetworkFee).equals('2100')

    // The chain's own asset has no parent:
    expect(fromEdgeTx(tx, null, 'BTC').parentNetworkFee).equals(undefined)
  })

  it('cannot round-trip a two-asset transaction through EdgeTransaction', function () {
    // Not a defect -- it is the reason the database stores an `EdgeTx`.
    // `EdgeTransaction` can only describe one asset at a time.
    const tx = makeTx({
      nativeAmounts: new Map([
        [null, '-100'],
        ['abc', '50']
      ])
    })
    const back = toEdgeTx(fromEdgeTx(tx, null, 'BTC'), 'bitcoin')
    expect([...back.nativeAmounts]).deep.equals([[null, '-100']])
  })
})

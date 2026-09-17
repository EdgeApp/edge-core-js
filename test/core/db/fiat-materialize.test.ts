import { expect } from 'chai'
import { rmSync } from 'fs'
import { describe, it } from 'mocha'
import { tmpdir } from 'os'
import { join } from 'path'

import { asTransactionFile } from '../../../src/core/currency/wallet/currency-wallet-cleaners'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  materializeFiat,
  readDefaultIsoFiat,
  saveTokens,
  toleranceForAge,
  writeDefaultIsoFiat
} from '../../../src/core/db/fiat-materialize'
import { saveTxMetas } from '../../../src/core/db/meta-writer'
import {
  openRateCache,
  RATE_DATABASE_NAME,
  RATE_SCHEMA,
  saveRates
} from '../../../src/core/db/rate-cache'
import { queryTxPage } from '../../../src/core/db/tx-query'
import { saveTxs } from '../../../src/core/db/tx-writer'
import { makeNodeIo } from '../../../src/index'
import { EdgeTx } from '../../../src/types/types'

/**
 * Filling `fiat_amount`.
 *
 * Two rules carry the weight. A figure the user typed always wins and must
 * never be overwritten by a lookup -- which is what `fiat_is_user` is for.
 * And a row with no rate close enough stays NULL, which reads as "not yet
 * known" rather than as zero.
 */

const NOON = 1717243200 // 2024-06-01T12:00:00Z
const HOUR = 60 * 60

let counter = 0

interface Fixture {
  driver: EdgeSqlDriver
  path: string
}

function makeTx(overrides: Partial<EdgeTx> = {}): EdgeTx {
  return {
    walletId: 'W1',
    txid: 'tx1',
    pluginId: 'bitcoin',
    date: new Date(NOON * 1000).toISOString(),
    blockHeight: 800000,
    isSend: true,
    nativeAmounts: new Map([[null, '150000000']]),
    networkFees: new Map(),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map(),
    ...overrides
  }
}

async function setup(): Promise<Fixture> {
  const path = join(tmpdir(), `edge-fiat-${process.pid}-${counter++}`)
  const io = makeNodeIo(path)
  if (io.makeSqlDriver == null) throw new Error('No SQL driver')

  const cache = await openRateCache(io)
  if (cache == null) throw new Error('No rate cache')
  await saveRates(cache.driver, [
    {
      pluginId: 'bitcoin',
      tokenId: null,
      fiatCode: 'iso:USD',
      bucket: NOON,
      rate: 68000
    }
  ])
  await cache.close()

  const driver = await io.makeSqlDriver('account', new Uint8Array(32).fill(1))
  await prepareDatabase(driver)
  await driver.attach(RATE_DATABASE_NAME, RATE_SCHEMA)
  await saveTokens(driver, [
    {
      pluginId: 'bitcoin',
      tokenId: null,
      currencyCode: 'BTC',
      multiplier: '100000000'
    }
  ])
  return { driver, path }
}

async function fiat(driver: EdgeSqlDriver): Promise<unknown[]> {
  return await driver.query(
    'SELECT fiat_amount, fiat_is_user FROM tx_asset_idx'
  )
}

describe('fiat materialization', function () {
  it('applies the denomination, not just the rate', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])

      const result = await materializeFiat(driver, { now: NOON })
      expect(result.fromRates).equals(1)

      // 1.5 BTC at 68000. Without `token.multiplier` this would be
      // 150000000 x 68000 -- wrong by eight orders of magnitude, and it would
      // still look like a number.
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: 102000, fiat_is_user: 0 }
      ])
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('prefers what the user typed', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'tx1',
          file: asTransactionFile({
            txid: 'tx1',
            internal: false,
            creationDate: NOON,
            currencies: {},
            tokens: {
              '': { metadata: { exchangeAmount: { 'iso:USD': 99999 } } }
            }
          })
        }
      ])

      const result = await materializeFiat(driver, { now: NOON })
      expect(result.fromUser).equals(1)
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: 99999, fiat_is_user: 1 }
      ])
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('never lets a lookup overwrite what the user typed', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await saveTxMetas(driver, 'W1', 'BTC', [
        {
          txid: 'tx1',
          file: asTransactionFile({
            txid: 'tx1',
            internal: false,
            creationDate: NOON,
            currencies: {},
            tokens: {
              '': { metadata: { exchangeAmount: { 'iso:USD': 99999 } } }
            }
          })
        }
      ])
      await materializeFiat(driver, { now: NOON })

      // A backfill without `fiat_is_user` could not tell a stale lookup from
      // a deliberate annotation, and would eventually clobber the user's own
      // number. Run it again and nothing moves.
      const again = await materializeFiat(driver, { now: NOON })
      expect(again.fromRates).equals(0)
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: 99999, fiat_is_user: 1 }
      ])
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('leaves a row with no nearby rate blank', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      // A year before the only rate in the cache:
      await saveTxs(driver, [
        makeTx({
          date: new Date((NOON - 365 * 24 * HOUR) * 1000).toISOString()
        })
      ])

      await materializeFiat(driver, { now: NOON })
      // Blank, never zero: the difference between "we do not know" and "it was
      // worth nothing" is the whole point.
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: null, fiat_is_user: 0 }
      ])
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('narrows the tolerance for a recent transaction', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      // Two hours after the only rate, and only minutes old. An old
      // transaction would accept this; a fresh one must not.
      await saveTxs(driver, [
        makeTx({ date: new Date((NOON + 2 * HOUR) * 1000).toISOString() })
      ])

      await materializeFiat(driver, { now: NOON + 2 * HOUR })
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: null, fiat_is_user: 0 }
      ])
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('widens the tolerance for an old one', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [
        makeTx({ date: new Date((NOON + 2 * HOUR) * 1000).toISOString() })
      ])

      // The same transaction, a year later. A two-hour-old rate is an
      // acceptable display value for history.
      await materializeFiat(driver, { now: NOON + 365 * 24 * HOUR })
      const rows = await driver.query<{ fiat_amount: number }>(
        'SELECT fiat_amount FROM tx_asset_idx'
      )
      expect(rows[0].fiat_amount).equals(102000)
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('empties every amount when the currency changes', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await materializeFiat(driver, { now: NOON })
      expect((await fiat(driver))[0]).deep.equals({
        fiat_amount: 102000,
        fiat_is_user: 0
      })

      // Instant and local. Refilling is the network's problem, and a query in
      // the meantime returns blanks rather than amounts in the old currency.
      expect(await writeDefaultIsoFiat(driver, 'iso:EUR')).equals(true)
      expect(await fiat(driver)).deep.equals([
        { fiat_amount: null, fiat_is_user: 0 }
      ])
      expect(await readDefaultIsoFiat(driver)).equals('iso:EUR')

      // And a user's own figure goes with it: it was in the old currency and
      // is not convertible.
      const again = await materializeFiat(driver, { now: NOON })
      expect(again.fromRates).equals(0)
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('does nothing when the currency has not changed', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await materializeFiat(driver, { now: NOON })

      // A setter that is not a no-op re-rates the whole account on each boot.
      expect(await writeDefaultIsoFiat(driver, 'iso:USD')).equals(false)
      expect((await fiat(driver))[0]).deep.equals({
        fiat_amount: 102000,
        fiat_is_user: 0
      })
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('does nothing before a currency is chosen', async function () {
    const { driver, path } = await setup()
    try {
      await saveTxs(driver, [makeTx()])
      // Not an error: an account with no fiat currency chosen has no correct
      // amount to show.
      expect(await materializeFiat(driver, { now: NOON })).deep.equals({
        fromUser: 0,
        fromRates: 0
      })
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('narrows the tolerance by age', function () {
    expect(toleranceForAge(0)).equals(5 * 60)
    expect(toleranceForAge(2 * HOUR)).equals(5 * 60)
    expect(toleranceForAge(2 * 24 * HOUR)).equals(HOUR)
    expect(toleranceForAge(60 * 24 * HOUR)).equals(12 * HOUR)
  })

  it('reaches a reader through the query, per asset', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await materializeFiat(driver, { now: NOON })

      const page = await queryTxPage(driver, {})
      expect(page.transactions[0].fiatAmounts?.get(null)).equals(102000)
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('leaves an unknown asset out rather than saying zero', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      // A token with no rate and no denomination on file:
      await saveTxs(driver, [
        makeTx({ nativeAmounts: new Map([['abc', '5']]) })
      ])
      await materializeFiat(driver, { now: NOON })

      const page = await queryTxPage(driver, {})
      // Absent, not zero. A reader showing zero would be showing something
      // false about what a transaction was worth.
      expect(page.transactions[0].fiatAmounts).equals(undefined)
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('is never stored in the document', async function () {
    const { driver, path } = await setup()
    try {
      await writeDefaultIsoFiat(driver, 'iso:USD')
      await saveTxs(driver, [makeTx()])
      await materializeFiat(driver, { now: NOON })

      // Storing it would mean every transaction in a wallet going stale the
      // moment a rate or the currency moved.
      const rows = await driver.query<{ doc: string }>(
        'SELECT json(doc) AS doc FROM tx_chain'
      )
      expect(rows[0].doc).does.not.include('fiatAmounts')
    } finally {
      await driver.close()
      rmSync(path, { force: true, recursive: true })
    }
  })
})

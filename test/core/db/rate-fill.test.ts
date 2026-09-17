import { expect } from 'chai'
import { rmSync } from 'fs'
import { describe, it } from 'mocha'
import { tmpdir } from 'os'
import { join } from 'path'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  saveTokens,
  writeDefaultIsoFiat
} from '../../../src/core/db/fiat-materialize'
import {
  openRateCache,
  RATE_DATABASE_NAME,
  RATE_SCHEMA,
  saveRates
} from '../../../src/core/db/rate-cache'
import { rateBucket, RATES_BATCH_SIZE } from '../../../src/core/db/rate-client'
import { fillFiatAmounts, findRateGaps } from '../../../src/core/db/rate-fill'
import { saveTxs } from '../../../src/core/db/tx-writer'
import { makeNodeIo } from '../../../src/index'
import { EdgeFetchFunction, EdgeTx } from '../../../src/types/types'

/**
 * The fill path.
 *
 * Its whole job is to not be one fetch per transaction. What the cache needs
 * is coverage of the timeline, so a transaction close enough to a rate already
 * held asks for nothing -- and the cost tracks the age of a wallet rather than
 * how busy it was.
 */

const NOON = 1717243200
const HOUR = 60 * 60
const DAY = 24 * HOUR

let counter = 0

interface Fixture {
  driver: EdgeSqlDriver
  rateDriver: EdgeSqlDriver
  path: string
  close: () => void
}

function makeTx(txid: string, date: number): EdgeTx {
  return {
    walletId: 'W1',
    txid,
    pluginId: 'bitcoin',
    date: new Date(date * 1000).toISOString(),
    blockHeight: 1,
    isSend: true,
    nativeAmounts: new Map([[null, '100000000']]),
    networkFees: new Map(),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map()
  }
}

async function setup(): Promise<Fixture> {
  const path = join(tmpdir(), `edge-fill-${process.pid}-${counter++}`)
  const io = makeNodeIo(path)
  if (io.makeSqlDriver == null) throw new Error('No SQL driver')

  const cache = await openRateCache(io)
  if (cache == null) throw new Error('No rate cache')

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
  await writeDefaultIsoFiat(driver, 'iso:USD')

  return {
    driver,
    rateDriver: cache.driver,
    path,
    close: () => {
      rmSync(path, { force: true, recursive: true })
    }
  }
}

/** A rate server that answers everything it is asked, and counts requests. */
function makeFakeServer(): {
  fetch: EdgeFetchFunction
  requests: number
  assets: number
} {
  const state = { requests: 0, assets: 0 }
  const fetch: EdgeFetchFunction = async (uri, opts) => {
    state.requests++
    const body: { crypto: unknown[] } = JSON.parse(
      String(opts?.body ?? '{"crypto":[]}')
    )
    state.assets += body.crypto.length
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: (body.crypto as any[]).map(entry => ({
          isoDate: entry.isoDate,
          asset: entry.asset,
          rate: 68000
        }))
      })
    } as any
  }
  return {
    fetch,
    get requests() {
      return state.requests
    },
    get assets() {
      return state.assets
    }
  }
}

describe('rate buckets', function () {
  it('floors the way the server does', function () {
    // The server buckets to one minute inside five minutes and to five
    // minutes after that, and floors rather than rounding. Keying our cache
    // differently would make two fetches for 14:03 and 14:04 into two rows
    // holding the same number.
    const now = 1717243500
    expect(rateBucket(1717243499, now)).equals(1717243440)
    expect(rateBucket(1717000000, now)).equals(1717000000 - (1717000000 % 300))
  })
})

describe('rate fill', function () {
  it('asks for nothing when the cache already covers a transaction', async function () {
    const fixture = await setup()
    try {
      await saveRates(fixture.rateDriver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: NOON,
          rate: 68000
        }
      ])
      // A year old, so the tolerance is twelve hours, and this rate is two
      // hours away.
      await saveTxs(fixture.driver, [makeTx('tx1', NOON + 2 * HOUR)])

      expect(
        await findRateGaps(fixture.driver, { now: NOON + 365 * DAY })
      ).deep.equals([])
    } finally {
      await fixture.driver.close()
      await fixture.rateDriver.close()
      fixture.close()
    }
  })

  it('collapses many transactions into few requests', async function () {
    const fixture = await setup()
    try {
      // Two hundred transactions across one afternoon, all old enough to
      // share a twelve-hour tolerance. The point of coverage is that this is
      // not two hundred fetches.
      const txs: EdgeTx[] = []
      for (let i = 0; i < 200; ++i) {
        txs.push(makeTx(`tx${i}`, NOON + i * 60))
      }
      await saveTxs(fixture.driver, txs)

      const server = makeFakeServer()
      const result = await fillFiatAmounts({
        driver: fixture.driver,
        rateDriver: fixture.rateDriver,
        fetch: server.fetch,
        server: 'https://rates.example',
        now: NOON + 365 * DAY
      })

      expect(server.assets).is.below(20)
      expect(result.rates).is.above(0)

      // And every one of them ended up with an amount:
      expect(
        await fixture.driver.query(
          'SELECT count(*) AS n FROM tx_asset_idx WHERE fiat_amount IS NULL'
        )
      ).deep.equals([{ n: 0 }])
    } finally {
      await fixture.driver.close()
      await fixture.rateDriver.close()
      fixture.close()
    }
  })

  it('reports which transactions changed, not that something did', async function () {
    const fixture = await setup()
    try {
      await saveTxs(fixture.driver, [
        makeTx('tx1', NOON),
        makeTx('tx2', NOON + 60)
      ])

      const server = makeFakeServer()
      const result = await fillFiatAmounts({
        driver: fixture.driver,
        rateDriver: fixture.rateDriver,
        fetch: server.fetch,
        server: 'https://rates.example',
        now: NOON + 365 * DAY
      })

      // Only the core knows which rows a batch of rates covered, which is why
      // this is its job and not the reader's.
      expect(new Set(result.changed.map(row => row.txid))).deep.equals(
        new Set(['tx1', 'tx2'])
      )
    } finally {
      await fixture.driver.close()
      await fixture.rateDriver.close()
      fixture.close()
    }
  })

  it('survives a server that refuses', async function () {
    const fixture = await setup()
    try {
      await saveTxs(fixture.driver, [makeTx('tx1', NOON)])

      const errors: unknown[] = []
      const result = await fillFiatAmounts({
        driver: fixture.driver,
        rateDriver: fixture.rateDriver,
        fetch: (async () => ({ ok: false, status: 503 })) as any,
        server: 'https://rates.example',
        now: NOON + 365 * DAY,
        onError: error => errors.push(error)
      })

      // A missing rate is a blank amount, which the next pass retries. It is
      // never an error the user sees.
      expect(result.rates).equals(0)
      expect(errors.length).equals(1)
      expect(
        await fixture.driver.query('SELECT fiat_amount FROM tx_asset_idx')
      ).deep.equals([{ fiat_amount: null }])
    } finally {
      await fixture.driver.close()
      await fixture.rateDriver.close()
      fixture.close()
    }
  })

  it('does nothing before a currency is chosen', async function () {
    const path = join(tmpdir(), `edge-fill-${process.pid}-${counter++}`)
    try {
      const io = makeNodeIo(path)
      if (io.makeSqlDriver == null) throw new Error('No SQL driver')
      const cache = await openRateCache(io)
      if (cache == null) throw new Error('No rate cache')
      const driver = await io.makeSqlDriver('a', new Uint8Array(32).fill(1))
      await prepareDatabase(driver)
      await driver.attach(RATE_DATABASE_NAME, RATE_SCHEMA)
      await saveTxs(driver, [makeTx('tx1', NOON)])

      const server = makeFakeServer()
      expect(
        await fillFiatAmounts({
          driver,
          rateDriver: cache.driver,
          fetch: server.fetch,
          server: 'https://rates.example'
        })
      ).deep.equals({ rates: 0, changed: [] })
      expect(server.requests).equals(0)

      await driver.close()
      await cache.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('batches large backfills', async function () {
    const fixture = await setup()
    try {
      // Spread far enough apart that coverage cannot collapse them, so the
      // batching is what is being measured.
      const txs: EdgeTx[] = []
      for (let i = 0; i < 150; ++i) {
        txs.push(makeTx(`tx${i}`, NOON - i * 2 * DAY))
      }
      await saveTxs(fixture.driver, txs)

      const server = makeFakeServer()
      await fillFiatAmounts({
        driver: fixture.driver,
        rateDriver: fixture.rateDriver,
        fetch: server.fetch,
        server: 'https://rates.example',
        now: NOON + 365 * DAY
      })

      expect(server.assets).is.above(RATES_BATCH_SIZE)
      expect(server.requests).is.above(1)
      // Bulk and per-date, which is what makes years of history affordable:
      expect(server.requests).is.below(
        Math.ceil(server.assets / RATES_BATCH_SIZE) + 1
      )
    } finally {
      await fixture.driver.close()
      await fixture.rateDriver.close()
      fixture.close()
    }
  })
})

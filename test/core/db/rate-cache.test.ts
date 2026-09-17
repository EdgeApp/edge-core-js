import { expect } from 'chai'
import { existsSync, readFileSync, rmSync } from 'fs'
import { describe, it } from 'mocha'
import { tmpdir } from 'os'
import { join } from 'path'

import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  nearestRate,
  openRateCache,
  RATE_DATABASE_NAME,
  RATE_SCHEMA,
  saveRates
} from '../../../src/core/db/rate-cache'
import { makeNodeIo } from '../../../src/index'
import { expectRejection } from '../../expect-rejection'

/**
 * The device-wide rate cache.
 *
 * It is the one store here that belongs to the device rather than to an
 * account, and the one that is deliberately unencrypted. Both of those are
 * decisions rather than oversights, so both are asserted.
 */

let counter = 0
function makeTempPath(): string {
  return join(tmpdir(), `edge-rates-${process.pid}-${counter++}`)
}

const HOUR = 60 * 60

describe('rate cache', function () {
  it('stores and reads a rate', async function () {
    const path = makeTempPath()
    try {
      const cache = await openRateCache(makeNodeIo(path))
      if (cache == null) throw new Error('No rate cache')

      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: 1717243200,
          rate: 68000
        }
      ])

      expect(
        await nearestRate(cache.driver, {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          date: 1717243200
        })
      ).equals(68000)
      await cache.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('takes the closest rate, not the first', async function () {
    const path = makeTempPath()
    try {
      const cache = await openRateCache(makeNodeIo(path))
      if (cache == null) throw new Error('No rate cache')

      const noon = 1717243200
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: noon - 4 * HOUR,
          rate: 60000
        },
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: noon + HOUR,
          rate: 68000
        },
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: noon + 6 * HOUR,
          rate: 70000
        }
      ])

      // A transaction rarely sits on a bucket, so the nearest one wins --
      // including one *after* it.
      expect(
        await nearestRate(cache.driver, {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          date: noon
        })
      ).equals(68000)
      await cache.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('returns nothing inside a gap', async function () {
    const path = makeTempPath()
    try {
      const cache = await openRateCache(makeNodeIo(path))
      if (cache == null) throw new Error('No rate cache')

      const noon = 1717243200
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: noon - 20 * HOUR,
          rate: 60000
        }
      ])

      // Nothing within the window, so the fiat amount stays blank rather than
      // being filled from a rate a day away.
      expect(
        await nearestRate(cache.driver, {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          date: noon
        })
      ).equals(undefined)
      await cache.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('keeps assets and currencies apart', async function () {
    const path = makeTempPath()
    try {
      const cache = await openRateCache(makeNodeIo(path))
      if (cache == null) throw new Error('No rate cache')

      const noon = 1717243200
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: noon,
          rate: 68000
        },
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:EUR',
          bucket: noon,
          rate: 63000
        },
        {
          pluginId: 'ethereum',
          tokenId: 'abc',
          fiatCode: 'iso:USD',
          bucket: noon,
          rate: 1
        }
      ])

      const at = async (
        pluginId: string,
        tokenId: string | null,
        fiatCode: string
      ): Promise<number | undefined> =>
        await nearestRate(cache.driver, {
          pluginId,
          tokenId,
          fiatCode,
          date: noon
        })

      expect(await at('bitcoin', null, 'iso:USD')).equals(68000)
      expect(await at('bitcoin', null, 'iso:EUR')).equals(63000)
      expect(await at('ethereum', 'abc', 'iso:USD')).equals(1)
      expect(await at('ethereum', null, 'iso:USD')).equals(undefined)
      await cache.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('is shared between accounts, and survives one closing', async function () {
    const path = makeTempPath()
    try {
      const io = makeNodeIo(path)
      const first = await openRateCache(io)
      if (first == null) throw new Error('No rate cache')
      await saveRates(first.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: 1717243200,
          rate: 68000
        }
      ])
      await first.close()

      // A second account on the device starts warm, which is the whole reason
      // this is not inside an account database.
      const second = await openRateCache(io)
      if (second == null) throw new Error('No rate cache')
      expect(
        await nearestRate(second.driver, {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          date: 1717243200
        })
      ).equals(68000)
      await second.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('is deliberately unencrypted', async function () {
    const path = makeTempPath()
    try {
      const cache = await openRateCache(makeNodeIo(path))
      if (cache == null) throw new Error('No rate cache')
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: 1717243200,
          rate: 68000
        }
      ])
      await cache.driver.exec([{ sql: 'PRAGMA wal_checkpoint(TRUNCATE)' }])
      await cache.close()

      // Not an oversight: encrypting it would need a device-scoped key, and
      // two of the four platforms have nowhere to keep one. The exposure is a
      // coarse holdings fingerprint, which is why the file is readable here.
      const file = join(path, 'databases', `${RATE_DATABASE_NAME}.db`)
      expect(readFileSync(file, 'latin1').slice(0, 15)).equals(
        'SQLite format 3'
      )
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('still refuses every other file without a key', async function () {
    const path = makeTempPath()
    try {
      const io = makeNodeIo(path)
      if (io.makeSqlDriver == null) throw new Error('No SQL driver')
      // The exception is the rate cache by name, not keyless files in general.
      await expectRejection(io.makeSqlDriver('account', new Uint8Array(0)))
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('attaches through a path that needs escaping', async function () {
    // The path is spliced into a SQL string literal *and* read as a URI, so
    // it has to survive both. A quote would end the literal early; a question
    // mark would be read as the start of a query string.
    const path = `${makeTempPath()}-it's #odd?`
    try {
      const io = makeNodeIo(path)
      if (io.makeSqlDriver == null) throw new Error('No SQL driver')

      const cache = await openRateCache(io)
      if (cache == null) throw new Error('No rate cache')
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: 1717243200,
          rate: 68000
        }
      ])
      await cache.close()

      const account = await io.makeSqlDriver(
        'account',
        new Uint8Array(32).fill(0x2b)
      )
      await account.attach(RATE_DATABASE_NAME, RATE_SCHEMA)
      expect(
        await account.query(
          `SELECT rate FROM ${RATE_SCHEMA}.fiat_rate WHERE plugin_id = 'bitcoin'`
        )
      ).deep.equals([{ rate: 68000 }])
      await account.close()
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('attaches to an account database read-only', async function () {
    const path = makeTempPath()
    try {
      const io = makeNodeIo(path)
      if (io.makeSqlDriver == null) throw new Error('No SQL driver')

      const cache = await openRateCache(io)
      if (cache == null) throw new Error('No rate cache')
      await saveRates(cache.driver, [
        {
          pluginId: 'bitcoin',
          tokenId: null,
          fiatCode: 'iso:USD',
          bucket: 1717243200,
          rate: 68000
        }
      ])
      await cache.close()

      const account = await io.makeSqlDriver(
        'account',
        new Uint8Array(32).fill(0x2b)
      )
      await prepareDatabase(account)
      await account.attach(RATE_DATABASE_NAME, RATE_SCHEMA)

      // The join the fiat materialization needs, in one statement rather than
      // two queries and a merge in JavaScript:
      expect(
        await account.query(
          `SELECT rate FROM ${RATE_SCHEMA}.fiat_rate WHERE plugin_id = 'bitcoin'`
        )
      ).deep.equals([{ rate: 68000 }])

      // Read-only: the core writes rates through its own connection, and a
      // write from here would race that writer.
      await expectRejection(
        account.exec([{ sql: `DELETE FROM ${RATE_SCHEMA}.fiat_rate` }])
      )

      await account.close()
      expect(existsSync(join(path, 'databases', 'rates.db'))).equals(true)
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })
})

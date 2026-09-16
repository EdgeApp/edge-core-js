import { EdgeInternalIo, EdgeSqlDriver } from './db-driver'

/**
 * The device-wide rate cache.
 *
 * This is the only store in the design that is **not about one account**.
 * Rates are public market data: the BTC/USD rate at 14:30 is the same number
 * for every account on the device, and fetching it once per account is pure
 * waste. It also needs nothing atomic with anything else -- a rate landing and
 * the fiat amount that follows are independently retryable -- so nothing spans
 * the two files transactionally.
 *
 * What living on its own buys, beyond deduplication: it survives logout and
 * account deletion, so a user who logs into a second account starts with a
 * warm cache rather than refetching years of history. It is shared with the
 * CLI, which points at the same directory. And account databases get smaller,
 * so their rebuild no longer drags rate history with it.
 *
 * **It is not encrypted.** Encrypting it would need a device-scoped key, and
 * there is no cross-platform place to keep one -- `edge-cli` has no keychain
 * and Electron's equivalent is not dependable. A key that exists on two of
 * four platforms is a fork, not a design.
 *
 * The exposure that buys is worth stating plainly, so nobody rediscovers it as
 * a surprise. The rates are public, but a row exists only because some account
 * on this device wanted that asset at that time -- so the file reveals **which
 * assets this device holds and roughly when it transacted in them**. It does
 * not reveal amounts, addresses, counterparties, txids or balances; those stay
 * in the encrypted account database.
 */

export const RATE_DATABASE_NAME = 'rates'

/** The schema alias an account database sees it under. */
export const RATE_SCHEMA = 'rates'

/**
 * Keyed by time bucket rather than by transaction.
 *
 * That is what keeps it small: every transaction of the same asset in the same
 * bucket shares one row. A per-transaction rates table would store the same
 * number back once per transaction, and would have to be rewritten wholesale
 * whenever the account's fiat currency changed.
 */
const schema = `
CREATE TABLE IF NOT EXISTS fiat_rate (
  plugin_id TEXT NOT NULL,
  token_id  TEXT NOT NULL,      -- '' is the chain's own asset
  fiat_code TEXT NOT NULL,      -- ISO 4217, as the rate server spells it
  bucket    INTEGER NOT NULL,   -- start of the time bucket, unix seconds
  rate      REAL NOT NULL,
  PRIMARY KEY (plugin_id, token_id, fiat_code, bucket)
);
`

export interface EdgeRateCache {
  driver: EdgeSqlDriver
  close: () => Promise<void>
}

/**
 * Opens the device's rate cache, creating it if this is the first account.
 *
 * Unkeyed, which the driver would normally refuse for a file -- so this goes
 * through the addon rather than the factory, and the refusal stays in place
 * for everything that is actually private.
 */
export async function openRateCache(
  io: EdgeInternalIo
): Promise<EdgeRateCache | undefined> {
  const { makeSqlDriver } = io
  if (makeSqlDriver == null) return undefined

  const driver = await makeSqlDriver(RATE_DATABASE_NAME, new Uint8Array(0))
  await driver.exec([{ sql: schema }])
  return { driver, close: async () => await driver.close() }
}

export interface EdgeRateRow {
  pluginId: string
  tokenId: string | null
  fiatCode: string
  /** Unix seconds, floored to the server's bucket. */
  bucket: number
  rate: number
}

/** Writes rates, replacing any already held for the same buckets. */
export async function saveRates(
  driver: EdgeSqlDriver,
  rates: EdgeRateRow[]
): Promise<void> {
  if (rates.length === 0) return
  await driver.batch(
    rates.map(rate => ({
      sql: `INSERT INTO fiat_rate (plugin_id, token_id, fiat_code, bucket, rate)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (plugin_id, token_id, fiat_code, bucket)
            DO UPDATE SET rate = excluded.rate`,
      params: [
        rate.pluginId,
        rate.tokenId ?? '',
        rate.fiatCode,
        rate.bucket,
        rate.rate
      ]
    }))
  )
}

/** The window `nearestRate` searches, in seconds either side. */
export const RATE_WINDOW_SECONDS = 12 * 60 * 60

/**
 * The closest rate to a moment, within a window.
 *
 * A transaction rarely sits exactly on a bucket, so this takes the *nearest*
 * rate rather than demanding an exact match. The `BETWEEN` is an index range
 * seek on the primary key, and the sort runs over at most a day of buckets.
 *
 * A gap wider than the window returns nothing, which is what leaves a fiat
 * amount blank rather than silently wrong.
 */
export function nearestRateSql(schema: string = 'main'): string {
  return `
  SELECT rate FROM ${schema}.fiat_rate
   WHERE plugin_id = ?1 AND token_id = ?2 AND fiat_code = ?3
     AND bucket BETWEEN ?4 - ?5 AND ?4 + ?5
   ORDER BY abs(bucket - ?4)
   LIMIT 1`
}

export async function nearestRate(
  driver: EdgeSqlDriver,
  opts: {
    pluginId: string
    tokenId: string | null
    fiatCode: string
    date: number
    window?: number
    /** `main` on the cache's own connection, `rates` on an account's. */
    schema?: string
  }
): Promise<number | undefined> {
  const rows = await driver.query<{ rate: number }>(
    nearestRateSql(opts.schema),
    [
      opts.pluginId,
      opts.tokenId ?? '',
      opts.fiatCode,
      opts.date,
      opts.window ?? RATE_WINDOW_SECONDS
    ]
  )
  return rows[0]?.rate
}

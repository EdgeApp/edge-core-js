import { EdgeSqlDriver } from './db-driver'
import { RATE_SCHEMA, RATE_WINDOW_SECONDS } from './rate-cache'

/**
 * Filling `tx_asset_idx.fiat_amount`.
 *
 * A fiat amount is a display figure derived from a rate that was itself an
 * approximation, and nobody reconciles it against a chain -- which is why it
 * is a `REAL` while a native amount is an exact string. The same storage
 * class, the opposite conclusion, for a reason.
 *
 * It is materialized rather than computed on read because a value computed at
 * read time cannot be indexed, and callers filter and sort on it.
 */

/**
 * How close a rate has to be, by how old the transaction is.
 *
 * A fixed twelve hours is too loose for a transaction from this morning and no
 * looser than necessary for one from 2019, so the tolerance narrows with
 * recency. It is deliberately coarser than the rate server, which buckets
 * everything to five minutes forever: matching that exactly would mean close
 * to one fetch per transaction, for a display figure.
 */
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const RATE_TOLERANCE = [
  { olderThan: 0, tolerance: 5 * MINUTE },
  { olderThan: DAY, tolerance: HOUR },
  { olderThan: 30 * DAY, tolerance: 12 * HOUR }
]

/** The window to search for a transaction of a given age, in seconds. */
export function toleranceForAge(ageSeconds: number): number {
  let out = RATE_TOLERANCE[0].tolerance
  for (const tier of RATE_TOLERANCE) {
    if (ageSeconds >= tier.olderThan) out = tier.tolerance
  }
  return Math.min(out, RATE_WINDOW_SECONDS)
}

/**
 * A SQL expression for the same thing, so one statement can fill every row.
 *
 * Written as nested `CASE`s rather than a helper function, because a
 * user-defined function in an UPDATE would make this statement unreadable by
 * anything but this build.
 */
function toleranceSql(nowColumn: string, dateColumn: string): string {
  // Wrapped in ascending order, so the widest tier ends up outermost and is
  // tested first. The other way round, every old transaction matches the
  // one-day tier and never reaches the thirty-day one.
  let out = String(RATE_TOLERANCE[0].tolerance)
  for (const tier of RATE_TOLERANCE) {
    if (tier.olderThan === 0) continue
    out = `CASE WHEN ${nowColumn} - ${dateColumn} >= ${tier.olderThan}
                THEN ${tier.tolerance} ELSE ${out} END`
  }
  return out
}

export interface MaterializeOptions {
  /** Limits the work to one wallet, for a targeted refill. */
  walletId?: string
  /** Overrides the clock, so a test can age a transaction. */
  now?: number
}

export interface MaterializeResult {
  /** Rows filled from what the user typed. */
  fromUser: number
  /** Rows filled from a looked-up rate. */
  fromRates: number
}

/**
 * Reads the account's fiat currency out of the database.
 *
 * Undefined before anything has set it, which is a real state: an account
 * that has never had a fiat currency chosen has no correct amount to show.
 */
export async function readDefaultIsoFiat(
  driver: EdgeSqlDriver
): Promise<string | undefined> {
  const rows = await driver.query<{ value: string | null }>(
    `SELECT value FROM setting WHERE key = 'defaultIsoFiat'`
  )
  return rows[0]?.value ?? undefined
}

export async function writeDefaultIsoFiat(
  driver: EdgeSqlDriver,
  fiatCode: string
): Promise<boolean> {
  const previous = await readDefaultIsoFiat(driver)
  if (previous === fiatCode) return false

  /*
   * A real change invalidates every stored amount at once, including the ones
   * the user typed -- their figure was in the old currency and is not
   * convertible. One statement, instant and local; refilling is the network's
   * problem and happens in the background.
   */
  await driver.batch([
    {
      sql: `INSERT INTO setting (key, value) VALUES ('defaultIsoFiat', ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      params: [fiatCode]
    },
    {
      sql: `UPDATE tx_asset_idx SET fiat_amount = NULL, fiat_is_user = 0`
    }
  ])
  return true
}

/**
 * Fills whatever fiat amounts it can, and leaves the rest NULL.
 *
 * Two passes, in precedence order. A figure the user typed always wins and
 * must never be overwritten by a lookup, which is what `fiat_is_user`
 * records -- without it a backfill could not tell a stale lookup from a
 * deliberate annotation, and would eventually clobber the user's own number.
 *
 * A row with no rate inside its window stays NULL. That reads as "not yet
 * known", never as zero.
 */
export async function materializeFiat(
  driver: EdgeSqlDriver,
  opts: MaterializeOptions = {}
): Promise<MaterializeResult> {
  const fiatCode = await readDefaultIsoFiat(driver)
  if (fiatCode == null) return { fromUser: 0, fromRates: 0 }

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const scope = opts.walletId == null ? '' : 'AND i.wallet_id = ?2'
  const params = opts.walletId == null ? [fiatCode] : [fiatCode, opts.walletId]

  /*
   * Pass one: what the user typed.
   *
   * `EdgeMetadata.exchangeAmount` is keyed by fiat code, so a user who
   * switched currencies keeps nothing unless they had also recorded a figure
   * in the new one.
   */
  const [fromUser] = await driver.exec([
    {
      sql: `
        UPDATE tx_asset_idx AS i
           SET fiat_amount = (
                 SELECT json_extract(
                          j.value,
                          '$.metadata.exchangeAmount.' || ?1
                        )
                   FROM tx_meta m, json_each(m.doc, '$.tokens') j
                  WHERE m.wallet_id = i.wallet_id AND m.txid = i.txid
                    AND j.key = i.token_id
               ),
               fiat_is_user = 1
         WHERE EXISTS (
                 SELECT 1 FROM tx_meta m, json_each(m.doc, '$.tokens') j
                  WHERE m.wallet_id = i.wallet_id AND m.txid = i.txid
                    AND j.key = i.token_id
                    AND json_extract(
                          j.value, '$.metadata.exchangeAmount.' || ?1
                        ) IS NOT NULL
               )
               ${scope}`,
      params
    }
  ])

  /*
   * Pass two: a looked-up rate, for everything the user did not answer.
   *
   * The multiplier is the term the design's formula leaves out. A rate is
   * quoted per whole coin and a native amount is in the chain's smallest
   * unit, so without `token.multiplier` the result is wrong by eight to
   * eighteen orders of magnitude.
   */
  const tolerance = toleranceSql(String(now), 'i.effective_date')
  const [fromRates] = await driver.exec([
    {
      sql: `
        UPDATE tx_asset_idx AS i
           SET fiat_amount = (
                 SELECT (CAST(a.value AS REAL) / CAST(t.multiplier AS REAL))
                        * r.rate
                   FROM tx_chain c,
                        json_each(c.doc, '$.nativeAmounts') a
                   JOIN token t
                     ON t.plugin_id = i.plugin_id AND t.token_id = i.token_id
                   JOIN ${RATE_SCHEMA}.fiat_rate r
                     ON r.plugin_id = i.plugin_id
                    AND r.token_id = i.token_id
                    AND r.fiat_code = ?1
                    AND r.bucket BETWEEN i.effective_date - (${tolerance})
                                     AND i.effective_date + (${tolerance})
                  WHERE c.wallet_id = i.wallet_id AND c.txid = i.txid
                    AND a.key = i.token_id
                  ORDER BY abs(r.bucket - i.effective_date)
                  LIMIT 1
               )
         WHERE i.fiat_is_user = 0 AND i.fiat_amount IS NULL
           /*
            * Only rows that will actually get a value. Without this the
            * UPDATE writes NULL over NULL and counts it as work, so the
            * returned count would say a backfill filled rows it did not.
            */
           AND EXISTS (
                 SELECT 1
                   FROM token t
                   JOIN ${RATE_SCHEMA}.fiat_rate r
                     ON r.plugin_id = i.plugin_id
                    AND r.token_id = i.token_id
                    AND r.fiat_code = ?1
                    AND r.bucket BETWEEN i.effective_date - (${tolerance})
                                     AND i.effective_date + (${tolerance})
                  WHERE t.plugin_id = i.plugin_id AND t.token_id = i.token_id
               )
           ${scope}`,
      params
    }
  ])

  return { fromUser, fromRates }
}

export interface EdgeTokenRow {
  pluginId: string
  tokenId: string | null
  currencyCode: string
  /** Multiply a display amount by this to get a native one. */
  multiplier: string
}

/**
 * Records currency codes and denominations.
 *
 * Written from the running plugins rather than derived, because only they
 * know. Nothing else in the schema depends on this table -- the transaction
 * index deliberately does not read it, so a transaction can be indexed before
 * its tokens are registered, and a denomination correction cannot
 * retroactively change what is stored.
 */
export async function saveTokens(
  driver: EdgeSqlDriver,
  tokens: EdgeTokenRow[]
): Promise<void> {
  if (tokens.length === 0) return
  await driver.batch(
    tokens.map(token => ({
      sql: `INSERT INTO token (plugin_id, token_id, currency_code, multiplier)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (plugin_id, token_id) DO UPDATE SET
              currency_code = excluded.currency_code,
              multiplier = excluded.multiplier`,
      params: [
        token.pluginId,
        token.tokenId ?? '',
        token.currencyCode,
        token.multiplier
      ]
    }))
  )
}

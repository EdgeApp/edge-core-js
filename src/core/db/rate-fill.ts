import { EdgeFetchFunction } from '../../types/types'
import { EdgeSqlDriver } from './db-driver'
import {
  materializeFiat,
  readDefaultIsoFiat,
  toleranceForAge,
  toleranceSql
} from './fiat-materialize'
import { RATE_SCHEMA, saveRates } from './rate-cache'
import { EdgeRateRequest, fetchRates } from './rate-client'

/**
 * Filling in fiat amounts.
 *
 * Rates are fetched **when a transaction arrives**, not when someone looks at
 * it, so by the time the user opens the list the amount is usually already
 * there. Reads are a pure fallback for whatever the write path missed: a query
 * returns `fiat_amount IS NULL` rows blank, and never blocks or fetches.
 */

export interface RateGap {
  pluginId: string
  tokenId: string | null
  /** The transaction's own time, which the server buckets for us. */
  date: number
}

/**
 * The asset-and-time pairs that have no rate close enough.
 *
 * This is the step that keeps a ten-thousand-transaction sync from becoming
 * ten thousand fetches: what the cache needs is not a rate per transaction but
 * **coverage of the timeline**, so a transaction within its tolerance of a
 * rate already held needs nothing at all. Five years of history is on the
 * order of a few thousand rates per asset however many transactions fall in
 * it, and the cost tracks the age of the wallet rather than its activity.
 */
export async function findRateGaps(
  driver: EdgeSqlDriver,
  opts: { now?: number; limit?: number } = {}
): Promise<RateGap[]> {
  const fiatCode = await readDefaultIsoFiat(driver)
  if (fiatCode == null) return []

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? 500

  /*
   * Newest first, because that is what a user is looking at. The tolerance is
   * applied in JavaScript rather than in SQL: it varies per row by age, and
   * expressing that as a correlated range makes a statement nobody can read
   * for a saving nobody measured.
   */
  const rows = await driver.query<{
    plugin_id: string
    token_id: string
    effective_date: number
  }>(
    `SELECT DISTINCT plugin_id, token_id, effective_date
       FROM tx_asset_idx
      WHERE fiat_amount IS NULL AND fiat_is_user = 0 AND plugin_id IS NOT NULL
      ORDER BY effective_date DESC
      LIMIT ?`,
    [limit]
  )

  /*
   * Which asset-and-time pairs the cache already covers, in one query rather
   * than one per row. On React Native every one of those is a bridge round
   * trip, so asking five hundred times to avoid five hundred fetches would
   * have traded one cost for another.
   *
   * The tolerance varies per row by age, which is why the join carries the
   * same nested CASE the materialization uses.
   */
  const tolerance = toleranceSql(String(now), 'i.effective_date')
  const coveredRows = await driver.query<{
    plugin_id: string
    token_id: string
    effective_date: number
  }>(
    `SELECT DISTINCT i.plugin_id, i.token_id, i.effective_date
       FROM tx_asset_idx i
       JOIN ${RATE_SCHEMA}.fiat_rate r
         ON r.plugin_id = i.plugin_id
        AND r.token_id = i.token_id
        AND r.fiat_code = ?1
        AND r.bucket BETWEEN i.effective_date - (${tolerance})
                         AND i.effective_date + (${tolerance})
      WHERE i.fiat_amount IS NULL AND i.fiat_is_user = 0`,
    [fiatCode]
  )
  const covered = new Set(
    coveredRows.map(
      row => `${row.plugin_id}\u001f${row.token_id}\u001f${row.effective_date}`
    )
  )

  const out: RateGap[] = []
  /*
   * What has already been decided *this pass*, per asset.
   *
   * Collapsing against the cache alone is not enough: on a first sync the
   * cache is empty, so every transaction looks like a gap. Once a rate is
   * going to be fetched for one moment, every transaction within its
   * tolerance is covered by it -- and that is the difference between a few
   * requests and one per transaction.
   */
  const planned = new Map<string, number[]>()

  for (const row of rows) {
    if (
      covered.has(
        `${row.plugin_id}\u001f${row.token_id}\u001f${row.effective_date}`
      )
    ) {
      continue
    }

    const key = `${row.plugin_id}\u001f${row.token_id}`
    const already = planned.get(key) ?? []
    const window = toleranceForAge(now - row.effective_date)
    if (already.some(date => Math.abs(date - row.effective_date) <= window)) {
      continue
    }

    already.push(row.effective_date)
    planned.set(key, already)
    out.push({
      pluginId: row.plugin_id,
      tokenId: row.token_id === '' ? null : row.token_id,
      date: row.effective_date
    })
  }
  return out
}

export interface FillResult {
  /** Rates fetched and stored. */
  rates: number
  /** Transactions whose stored form changed as a result. */
  changed: Array<{ walletId: string; txid: string }>
}

/**
 * One pass: find the gaps, fetch what fills them, and materialize.
 *
 * The caller is handed the transactions that changed rather than being told
 * "something did", because only the core knows which rows a batch of rates
 * covered -- and a per-row event would flood the bridge.
 */
export async function fillFiatAmounts(opts: {
  driver: EdgeSqlDriver
  rateDriver: EdgeSqlDriver
  fetch: EdgeFetchFunction
  server: string
  now?: number
  limit?: number
  onError?: (error: unknown) => void
}): Promise<FillResult> {
  const { driver, rateDriver, fetch, server, now, limit } = opts

  const fiatCode = await readDefaultIsoFiat(driver)
  if (fiatCode == null) return { rates: 0, changed: [] }

  const gaps = await findRateGaps(driver, { now, limit })
  if (gaps.length === 0) return { rates: 0, changed: [] }

  const requests: EdgeRateRequest[] = gaps.map(gap => ({
    pluginId: gap.pluginId,
    tokenId: gap.tokenId,
    date: gap.date
  }))

  const rates = await fetchRates(fetch, {
    server,
    targetFiat: fiatCode,
    requests,
    now,
    onError: opts.onError
  })
  if (rates.length === 0) return { rates: 0, changed: [] }

  // The rate cache is a separate file on purpose, so this write and the
  // materialization below are independently retryable rather than atomic.
  await saveRates(rateDriver, rates)

  // Which rows were blank before, so the event carries only what changed.
  const before = await driver.query<{ wallet_id: string; txid: string }>(
    `SELECT DISTINCT wallet_id, txid FROM tx_asset_idx
      WHERE fiat_amount IS NULL AND fiat_is_user = 0`
  )
  await materializeFiat(driver, { now })
  const after = await driver.query<{ wallet_id: string; txid: string }>(
    `SELECT DISTINCT wallet_id, txid FROM tx_asset_idx
      WHERE fiat_amount IS NULL AND fiat_is_user = 0`
  )

  const stillBlank = new Set(after.map(row => `${row.wallet_id}${row.txid}`))
  const changed = before
    .filter(row => !stillBlank.has(`${row.wallet_id}${row.txid}`))
    .map(row => ({ walletId: row.wallet_id, txid: row.txid }))

  return { rates: rates.length, changed }
}

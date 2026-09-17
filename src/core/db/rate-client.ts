import { EdgeFetchFunction } from '../../types/types'
import { EdgeRateRow } from './rate-cache'

/**
 * Fetching rates.
 *
 * The endpoint is bulk and per-date -- many assets at many different times in
 * one request -- which is exactly the shape a coverage backfill needs, and the
 * reason this can fill years of history without one request per transaction.
 */

/** What the GUI uses, and a reasonable starting point here. */
export const RATES_BATCH_SIZE = 100

const MINUTE = 60
const FIVE_MINUTES = 5 * MINUTE

/**
 * The bucket a moment belongs to, matching the rate server exactly.
 *
 * Read from `edge-rates-server`: one minute for anything in the last five
 * minutes, five minutes for everything else, forever. It **floors** rather
 * than rounds, and keying our cache the same way is what stops a value
 * fetched for 14:03 and one fetched for 14:04 becoming two rows holding the
 * same number.
 */
export function rateBucket(date: number, now: number): number {
  const interval = now - date < FIVE_MINUTES ? MINUTE : FIVE_MINUTES
  return Math.floor(date / interval) * interval
}

export interface EdgeRateRequest {
  pluginId: string
  tokenId: string | null
  /** Unix seconds. */
  date: number
}

interface ServerReply {
  data?: Array<{
    isoDate?: string
    asset?: { pluginId?: string; tokenId?: string | null }
    rate?: number | string
  }>
}

/**
 * Asks the rate server for a set of asset-and-time pairs.
 *
 * Batched, because the endpoint takes many at once and a request per
 * transaction is the cost this whole design exists to avoid. A batch that
 * fails is skipped rather than failing the rest: a missing rate leaves a
 * blank fiat amount, which the next pass retries.
 */
export async function fetchRates(
  fetch: EdgeFetchFunction,
  opts: {
    server: string
    targetFiat: string
    requests: EdgeRateRequest[]
    now?: number
    onError?: (error: unknown) => void
  }
): Promise<EdgeRateRow[]> {
  const { server, targetFiat, requests, now = Date.now() / 1000 } = opts
  const out: EdgeRateRow[] = []

  for (let i = 0; i < requests.length; i += RATES_BATCH_SIZE) {
    const batch = requests.slice(i, i + RATES_BATCH_SIZE)
    try {
      const response = await fetch(`${server}/v3/rates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetFiat,
          crypto: batch.map(request => ({
            isoDate: new Date(request.date * 1000).toISOString(),
            asset: { pluginId: request.pluginId, tokenId: request.tokenId }
          })),
          fiat: []
        })
      })
      if (!response.ok) throw new Error(`Rate server said ${response.status}`)

      const reply: ServerReply = await response.json()
      for (const row of reply.data ?? []) {
        const rate = Number(row.rate)
        if (row.isoDate == null || row.asset?.pluginId == null) continue
        if (!Number.isFinite(rate)) continue

        const date = Math.floor(new Date(row.isoDate).valueOf() / 1000)
        if (isNaN(date)) continue

        out.push({
          pluginId: row.asset.pluginId,
          tokenId: row.asset.tokenId ?? null,
          fiatCode: targetFiat,
          bucket: rateBucket(date, now),
          rate
        })
      }
    } catch (error) {
      // One bad batch must not lose the others. A missing rate is a blank
      // amount, and the next pass asks again.
      opts.onError?.(error)
    }
  }

  return out
}

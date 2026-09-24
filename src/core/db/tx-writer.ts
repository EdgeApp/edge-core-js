import { EdgeTx } from '../../types/types'
import { EdgeSqlDriver, EdgeSqlStatement } from './db-driver'
import { wasEdgeTx } from './tx-cleaners'

/**
 * Writing transactions.
 *
 * One transaction reaches the core **once per asset it touches**, each time
 * reporting only that asset's amount. A swap on an EVM chain arrives twice:
 * once as the token moving, once as the chain asset paying the fee. Neither
 * report is wrong and neither is complete.
 *
 * So writes merge rather than replace. The per-asset maps merge one asset at
 * a time -- the second asset's amount lands beside the first instead of on
 * top of it -- which is what makes the keyed shape of `EdgeTx` a storage
 * requirement rather than a matter of taste. Every other field, and every
 * asset's own entry, is replaced whole by the latest report that carries it,
 * and a field a report leaves out keeps what was stored.
 *
 * The merge sets each value by path rather than patching the document,
 * because a patch in the RFC 7386 sense reads `null` as "delete this key":
 * a second report of a swap would silently drop `tokenId: null` -- which
 * means the chain's own asset -- from inside its action, and the stored
 * transaction would then fail its own cleaner.
 */

/** The maps keyed by asset, which merge an asset at a time. */
const assetMaps = ['nativeAmounts', 'networkFees', 'tokenData']

/**
 * How many path-and-value pairs go into one `jsonb_set` call, which keeps
 * each call inside SQLite's limit on function arguments whatever the number
 * of assets.
 */
const PAIRS_PER_CALL = 40

/**
 * The SQL that merges one stored document with a new report of it.
 */
function mergeExpression(doc: { [key: string]: unknown }): {
  sql: string
  params: string[]
} {
  const pairs: Array<[string, unknown]> = []
  for (const key of Object.keys(doc)) {
    const value = doc[key]
    if (assetMaps.includes(key) && value != null && typeof value === 'object') {
      const map = value as { [tokenId: string]: unknown }
      for (const tokenId of Object.keys(map)) {
        pairs.push([`$.${key}.${JSON.stringify(tokenId)}`, map[tokenId]])
      }
    } else {
      pairs.push([`$.${key}`, value])
    }
  }

  let sql = 'doc'
  const params: string[] = []
  for (let i = 0; i < pairs.length; i += PAIRS_PER_CALL) {
    const chunk = pairs.slice(i, i + PAIRS_PER_CALL)
    sql = `jsonb_set(${sql}, ${chunk.map(() => '?, jsonb(?)').join(', ')})`
    for (const [path, value] of chunk) params.push(path, JSON.stringify(value))
  }
  return { sql, params }
}

/** The statements one `EdgeTx` contributes, for callers composing a batch. */
export function saveTxStatements(txs: EdgeTx[]): EdgeSqlStatement[] {
  return txs.map(tx => {
    const doc = wasEdgeTx(tx) as { [key: string]: unknown }
    const merge = mergeExpression(doc)
    return {
      sql: `INSERT INTO tx_chain (wallet_id, txid, doc)
            VALUES (?, ?, jsonb(?))
            ON CONFLICT (wallet_id, txid)
            DO UPDATE SET doc = ${merge.sql}`,
      params: [tx.walletId, tx.txid, JSON.stringify(doc), ...merge.params]
    }
  })
}

/**
 * Writes transactions, merging each into whatever is already stored.
 *
 * One batch, so a report covering several transactions either lands whole or
 * not at all -- and so the index triggers fire once per transaction inside a
 * single commit rather than once per statement across many.
 */
export async function saveTxs(
  driver: EdgeSqlDriver,
  txs: EdgeTx[]
): Promise<void> {
  if (txs.length === 0) return
  await driver.batch(saveTxStatements(txs))
}

/**
 * Replaces a transaction outright, dropping assets it no longer touches.
 *
 * Merging cannot remove a key, so a correction that *narrows* a transaction
 * needs this. Rare, and separate because it is the one write that can throw
 * away something another report contributed.
 */
export async function replaceTxs(
  driver: EdgeSqlDriver,
  txs: EdgeTx[]
): Promise<void> {
  if (txs.length === 0) return
  await driver.batch(
    txs.map(tx => ({
      sql: `INSERT INTO tx_chain (wallet_id, txid, doc)
            VALUES (?, ?, jsonb(?))
            ON CONFLICT (wallet_id, txid)
            DO UPDATE SET doc = excluded.doc`,
      params: [tx.walletId, tx.txid, JSON.stringify(wasEdgeTx(tx))]
    }))
  )
}

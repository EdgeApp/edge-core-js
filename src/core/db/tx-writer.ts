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
 * So writes merge rather than replace. `jsonb_patch` applies RFC 7386, which
 * merges objects key by key -- so the second asset's amount lands beside the
 * first instead of on top of it. That is what makes the keyed shape of
 * `EdgeTx` a storage requirement rather than a matter of taste.
 *
 * RFC 7386 replaces arrays wholesale, which is right for the arrays here:
 * `memos` and `ourReceiveAddresses` describe the transaction, not one asset's
 * view of it, so the latest report is the complete one.
 */

/** The statements one `EdgeTx` contributes, for callers composing a batch. */
export function saveTxStatements(txs: EdgeTx[]): EdgeSqlStatement[] {
  return txs.map(tx => ({
    sql: `INSERT INTO tx_chain (wallet_id, txid, doc)
          VALUES (?, ?, jsonb(?))
          ON CONFLICT (wallet_id, txid)
          DO UPDATE SET doc = jsonb_patch(doc, excluded.doc)`,
    params: [tx.walletId, tx.txid, JSON.stringify(wasEdgeTx(tx))]
  }))
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

import {
  EdgeBatchWrite,
  EdgeTableSpec,
  EdgeTokenId,
  EdgeTx,
  EdgeTxPatch
} from '../../types/types'
import { EdgeSqlDriver, EdgeSqlStatement } from './db-driver'
import { putRowStatements, removeRowStatements } from './plugin-rows'
import { saveTxStatements } from './tx-writer'

/**
 * Transaction and table writes that land together or not at all.
 *
 * This exists because separate calls would be separate SQLite transactions,
 * and the UTXO engine has two paths where that is a correctness bug rather
 * than untidiness. A send saves the transaction and then the UTXOs it
 * created: interrupted between the two, the balance understates by the change
 * and those coins are unspendable until a resync. An RBF replacement removes
 * the inputs it spends before saving the replacement: interrupted there, the
 * UTXOs are gone and no transaction accounts for them.
 *
 * Neither is protected today, because the locks that stand in for
 * transactions are per group -- and those two flows cross groups.
 *
 * No transaction handle is exposed. The caller describes the unit of work and
 * the core executes it, so a plugin cannot hold the write lock open across
 * its own `await`.
 */

/**
 * The order writes are applied in, whatever order the caller listed them.
 *
 * Fixed so that removing and re-adding the same key in one call has a defined
 * result. Within each group, the caller's array order is preserved.
 */
type Stage =
  | 'removeRows'
  | 'putRows'
  | 'putRowsIfAbsent'
  | 'saveTxs'
  | 'patchTxs'
const STAGES: Stage[] = [
  'removeRows',
  'putRows',
  'putRowsIfAbsent',
  'saveTxs',
  'patchTxs'
]

/** The token-keyed fields, which JSON spells with `''` for the chain asset. */
function fromTokenMap(map: Map<EdgeTokenId, unknown>): {
  [key: string]: unknown
} {
  const out: { [key: string]: unknown } = {}
  map.forEach((value, tokenId) => {
    out[tokenId == null ? '' : tokenId] = value
  })
  return out
}

/**
 * A patch as JSON, for `jsonb_patch`.
 *
 * Only the fields the caller sent, because RFC 7386 leaves anything absent
 * alone -- that is what makes a patch a patch. A `null` value deletes the
 * field, which is the only way to clear one.
 */
function patchJson(patch: EdgeTxPatch): string {
  const { txid, ...rest } = patch
  const out: { [field: string]: unknown } = {}

  for (const field of Object.keys(rest)) {
    const value = (rest as { [field: string]: unknown })[field]
    out[field] = value instanceof Map ? fromTokenMap(value) : value
  }
  return JSON.stringify(out)
}

/**
 * The statements one patch contributes.
 *
 * Two, not one. The `UPDATE` does the work, and the `INSERT` fails the batch
 * when the transaction was not there: it writes a NULL document, which the
 * schema refuses. That is what makes the check atomic with the update rather
 * than a read followed by a hope.
 */
function patchStatements(
  walletId: string,
  patch: EdgeTxPatch
): EdgeSqlStatement[] {
  return [
    {
      sql: `UPDATE tx_chain SET doc = jsonb_patch(doc, jsonb(?))
             WHERE wallet_id = ? AND txid = ?`,
      params: [patchJson(patch), walletId, patch.txid]
    },
    {
      sql: `INSERT INTO tx_chain (wallet_id, txid, doc)
            SELECT ?, ?, NULL
             WHERE NOT EXISTS (
               SELECT 1 FROM tx_chain WHERE wallet_id = ? AND txid = ?
             )`,
      params: [walletId, patch.txid, walletId, patch.txid]
    }
  ]
}

/**
 * A complete transaction, written under the handle's own wallet.
 *
 * Any `walletId` on the passed object is ignored: identity comes from the
 * handle, so a plugin cannot address another wallet's transaction even by
 * naming one.
 */
function saveStatement(walletId: string, tx: EdgeTx): EdgeSqlStatement {
  // The same merge as `saveTxs`, and for the same reason: nulls a report
  // carries are values, not deletions:
  return saveTxStatements([{ ...tx, walletId }])[0]
}

export interface BatchWriteContext {
  driver: EdgeSqlDriver
  walletId: string
  prefix: string
  spec: EdgeTableSpec
}

/**
 * Runs a whole unit of work as one SQLite transaction.
 *
 * Inside the boundary: every transaction created or patched, every plugin row
 * put or removed, and every index trigger they fire. A rolled-back write
 * leaves no index residue.
 *
 * Outside it, and not makeable atomic with it: the encrypted sync repo, which
 * is a separate store no plugin write touches, and the rate cache, which is a
 * separate file that needs no atomicity.
 */
export async function batchWrite(
  context: BatchWriteContext,
  ops: EdgeBatchWrite
): Promise<void> {
  const { driver, walletId, prefix, spec } = context

  // Checked before the batch purely so the error names the transaction. The
  // enforcement is the NULL document above, which cannot race.
  if (ops.patchTxs != null && ops.patchTxs.length > 0) {
    const txids = ops.patchTxs.map(patch => patch.txid)
    const rows = await driver.query<{ txid: string }>(
      `SELECT txid FROM tx_chain
        WHERE wallet_id = ? AND txid IN (${txids.map(() => '?').join(', ')})`,
      [walletId, ...txids]
    )
    const found = new Set(rows.map(row => row.txid))
    const missing = txids.filter(txid => !found.has(txid))
    if (missing.length > 0) {
      throw new Error(
        `Cannot patch transactions that do not exist: ${missing.join(', ')}. ` +
          'Use saveTxs to create one.'
      )
    }
  }

  const statements: EdgeSqlStatement[] = []
  for (const stage of STAGES) {
    switch (stage) {
      case 'removeRows':
        statements.push(
          ...removeRowStatements(prefix, spec, ops.removeRows ?? [])
        )
        break
      case 'putRows':
        statements.push(...putRowStatements(prefix, spec, ops.putRows ?? []))
        break
      case 'putRowsIfAbsent':
        statements.push(
          ...putRowStatements(prefix, spec, ops.putRowsIfAbsent ?? [], true)
        )
        break
      case 'saveTxs':
        for (const tx of ops.saveTxs ?? []) {
          statements.push(saveStatement(walletId, tx))
        }
        break
      case 'patchTxs':
        for (const patch of ops.patchTxs ?? []) {
          statements.push(...patchStatements(walletId, patch))
        }
        break
    }
  }

  if (statements.length === 0) return
  await driver.batch(statements)
}

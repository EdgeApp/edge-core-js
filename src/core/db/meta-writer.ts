import { uncleaner } from 'cleaners'

import {
  asTransactionFile,
  TransactionFile
} from '../currency/wallet/currency-wallet-cleaners'
import { EdgeSqlDriver, EdgeSqlStatement } from '../db/db-driver'

/**
 * Mirroring the sync-repo metadata into `tx_meta`.
 *
 * The sync repo stays authoritative: these rows are a cache of the encrypted
 * `transaction/*.json` files, which is what makes them rebuildable in seconds
 * rather than by a network resync.
 *
 * What the mirror buys is that metadata becomes *queryable*. A file per
 * transaction cannot answer "every transaction the user labelled Groceries"
 * without opening all of them, and the index triggers need the metadata
 * anyway to know an asset was annotated.
 */

const wasTransactionFile = uncleaner(asTransactionFile)

/** What a `tx_meta` document holds, beyond the file itself. */
interface TxMetaExtras {
  /**
   * True when this row is ahead of the file on disk.
   *
   * Today that only happens when writing the file failed, and the flusher
   * retries. When the read path swaps over and the database is written first,
   * this becomes the ordinary state of a fresh edit rather than the error one.
   */
  fileDirty: boolean
}

/**
 * The document for one transaction's metadata.
 *
 * Legacy Airbitz files keep their metadata under `currencies`, keyed by
 * currency code; modern ones use `tokens`, keyed by `tokenId`. The index
 * triggers read `tokens` only, so the conversion happens once, here, rather
 * than in every query that would otherwise have to know about both.
 */
export function toTxMetaDoc(
  file: TransactionFile,
  walletCurrency: string,
  extras: TxMetaExtras
): string {
  const raw: any = wasTransactionFile(file)

  const legacy = raw.currencies?.[walletCurrency]
  if (legacy != null && raw.tokens?.[''] == null) {
    raw.tokens = { ...raw.tokens, '': legacy }
  }

  return JSON.stringify({ ...raw, fileDirty: extras.fileDirty ? 1 : 0 })
}

export interface TxMetaWrite {
  txid: string
  file: TransactionFile
}

/**
 * What a write does to a row that is already there.
 *
 * - `replace` is the ordinary write: a metadata file is written whole by
 *   whoever last edited it, so it is a complete statement rather than one
 *   asset's contribution, and merging would make a deleted note
 *   un-deletable.
 * - `replaceClean` is a file arriving by sync. It is newer than the row --
 *   unless the row is dirty, because a dirty row is a local edit that never
 *   reached any file, so no file can be newer than it.
 * - `insert` leaves any existing row alone, which is what a bulk copy from
 *   older files wants: a row already there is at least as new as the file.
 */
export type TxMetaConflict = 'replace' | 'replaceClean' | 'insert'

const conflictClauses: { [mode in TxMetaConflict]: string } = {
  replace: 'DO UPDATE SET doc = excluded.doc',
  replaceClean: 'DO UPDATE SET doc = excluded.doc WHERE tx_meta.file_dirty = 0',
  insert: 'DO NOTHING'
}

/** The statements that write metadata rows. */
export function txMetaStatements(
  walletId: string,
  walletCurrency: string,
  writes: TxMetaWrite[],
  opts: { conflict: TxMetaConflict; extras?: TxMetaExtras }
): EdgeSqlStatement[] {
  const { extras = { fileDirty: false } } = opts
  const conflict = conflictClauses[opts.conflict]
  return writes.map(({ txid, file }) => ({
    sql: `INSERT INTO tx_meta (wallet_id, txid, doc)
          VALUES (?, ?, jsonb(?))
          ON CONFLICT (wallet_id, txid) ${conflict}`,
    params: [walletId, txid, toTxMetaDoc(file, walletCurrency, extras)]
  }))
}

/** Writes metadata rows, replacing whatever was there. */
export async function saveTxMetas(
  driver: EdgeSqlDriver,
  walletId: string,
  walletCurrency: string,
  writes: TxMetaWrite[],
  extras: TxMetaExtras = { fileDirty: false }
): Promise<void> {
  if (writes.length === 0) return
  await driver.batch(
    txMetaStatements(walletId, walletCurrency, writes, {
      conflict: 'replace',
      extras
    })
  )
}

/**
 * Writes the rows for files a sync brought in, leaving any row whose own
 * edit has not reached a file yet.
 */
export async function saveSyncedTxMetas(
  driver: EdgeSqlDriver,
  walletId: string,
  walletCurrency: string,
  writes: TxMetaWrite[]
): Promise<void> {
  if (writes.length === 0) return
  await driver.batch(
    txMetaStatements(walletId, walletCurrency, writes, {
      conflict: 'replaceClean'
    })
  )
}

/**
 * Writes metadata rows only where there are none.
 *
 * For copying files the database has never seen while the wallet is in use:
 * an edit or a sync that lands between reading a file and writing its row is
 * newer than that file, and a row whose file write failed must keep the flag
 * that gets it retried.
 */
export async function saveTxMetasIfAbsent(
  driver: EdgeSqlDriver,
  walletId: string,
  walletCurrency: string,
  writes: TxMetaWrite[]
): Promise<void> {
  if (writes.length === 0) return
  await driver.batch(
    txMetaStatements(walletId, walletCurrency, writes, { conflict: 'insert' })
  )
}

/**
 * The transactions whose metadata never reached the sync repo.
 *
 * Returned as documents rather than files because the caller re-reads them
 * through the file cleaner anyway, and this layer should not own that shape.
 */
export async function readDirtyTxMeta(
  driver: EdgeSqlDriver,
  walletId: string
): Promise<Array<{ txid: string; doc: unknown }>> {
  const rows = await driver.query<{ txid: string; doc: string }>(
    `SELECT txid, json(doc) AS doc FROM tx_meta
      WHERE wallet_id = ? AND file_dirty = 1`,
    [walletId]
  )
  return rows.map(row => ({ txid: row.txid, doc: JSON.parse(row.doc) }))
}

/** Marks rows as having reached the sync repo. */
export async function clearTxMetaDirty(
  driver: EdgeSqlDriver,
  walletId: string,
  txids: string[]
): Promise<void> {
  if (txids.length === 0) return
  await driver.batch(
    txids.map(txid => ({
      sql: `UPDATE tx_meta SET doc = jsonb_set(doc, '$.fileDirty', 0)
             WHERE wallet_id = ? AND txid = ?`,
      params: [walletId, txid]
    }))
  )
}

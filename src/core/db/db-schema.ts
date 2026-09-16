/**
 * The transaction schema.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * Two document tables hold the only authoritative bytes -- `tx_chain` for what
 * the blockchain says, `tx_meta` for what the user said -- and everything else
 * is derived from them by trigger. The two are separate because their rebuild
 * costs differ by orders of magnitude: `tx_meta` comes back from the sync repo
 * in seconds, `tx_chain` needs a network resync.
 *
 * Anything whose name ends in `_idx` is derived, and can be dropped and
 * rebuilt offline from the documents alone. Nothing else can.
 */

/**
 * Bumped whenever anything below changes.
 *
 * There is no migration path and there does not need to be one: every table
 * here is rebuildable, so a version mismatch drops the schema and recreates
 * it rather than trying to move data that can be reconstructed.
 */
export const SCHEMA_VERSION = 1

const documentTables = `
CREATE TABLE tx_chain (
  wallet_id    TEXT NOT NULL,
  txid         TEXT NOT NULL,
  doc          BLOB NOT NULL,                                       -- an EdgeTx
  plugin_id    TEXT    GENERATED ALWAYS AS (doc ->> '$.pluginId')          VIRTUAL,
  date         INTEGER GENERATED ALWAYS AS (unixepoch(doc ->> '$.date'))   VIRTUAL,
  block_height INTEGER GENERATED ALWAYS AS (doc ->> '$.blockHeight')       VIRTUAL,
  is_send      INTEGER GENERATED ALWAYS AS (doc ->> '$.isSend')            VIRTUAL,
  PRIMARY KEY (wallet_id, txid)
);

CREATE TABLE tx_meta (
  wallet_id     TEXT NOT NULL,
  txid          TEXT NOT NULL,
  doc           BLOB NOT NULL,                        -- the sync-repo metadata
  creation_date INTEGER GENERATED ALWAYS AS (doc ->> '$.creationDate') VIRTUAL,
  file_dirty    INTEGER GENERATED ALWAYS AS (doc ->> '$.fileDirty')    VIRTUAL,
  PRIMARY KEY (wallet_id, txid)
);
`

/**
 * The satellite table every account-wide query is answered from, at the grain
 * the GUI reads: one row per (wallet, transaction, asset). A transaction
 * touching two assets produces two rows, which is what lets an amount be
 * indexed at all -- a single row could hold only one of each amount, fee and
 * fiat value.
 *
 * `effective_date` is why this is a table rather than an index on `tx_chain`:
 * it spans both documents, so it cannot be a generated column on either.
 */
const assetIndex = `
CREATE TABLE tx_asset_idx (
  wallet_id         TEXT NOT NULL,
  txid              TEXT NOT NULL,
  token_id          TEXT NOT NULL,      -- '' is the chain's own asset
  has_chain         INTEGER NOT NULL DEFAULT 0,
  has_meta          INTEGER NOT NULL DEFAULT 0,
  effective_date    INTEGER NOT NULL,   -- min(chain date, metadata creation)
  plugin_id         TEXT,
  block_height      INTEGER,
  is_send           INTEGER,
  native_amount_key TEXT,               -- sortable; see edge_native_amount_key
  network_fee_key   TEXT,               -- same encoding, this asset's fee
  fiat_amount       REAL,               -- in the account's defaultIsoFiat
  fiat_is_user      INTEGER NOT NULL DEFAULT 0,
  has_metadata      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet_id, txid, token_id)
);

-- Three indexes over overlapping columns, because each puts a different
-- column first, and those are the three ways the GUI asks for a page. Drop
-- any one and the query it served falls back to a scan and a sort.

-- Account-wide: every wallet, newest first.
CREATE INDEX tx_asset_date_idx
  ON tx_asset_idx (effective_date DESC, txid DESC, token_id DESC);

-- One wallet's page, which is the commonest query in the app.
CREATE INDEX tx_asset_wallet_date_idx
  ON tx_asset_idx (wallet_id, effective_date DESC, txid DESC, token_id DESC);

-- One asset's page. Its cost scales with how *rare* the asset is, since a
-- scan would run until it had found enough matches.
CREATE INDEX tx_asset_token_date_idx
  ON tx_asset_idx (token_id, effective_date DESC, txid DESC);
`

/**
 * Every asset a transaction touches, from both documents.
 *
 * The union matters. A token transfer moves the token but pays its fee in the
 * chain's own asset, so it produces a token row with an amount and no fee, and
 * a chain-asset row with a fee and no amount. Metadata adds a third source:
 * the user can annotate an asset the chain data has not arrived for yet.
 *
 * `max()` picks the one non-NULL contribution per column, since each source
 * row fills exactly one of them.
 */
export function assetUnion(wallet: string, txid: string): string {
  return `
    SELECT
      token_id,
      max(native_amount) AS native_amount,
      max(network_fee)   AS network_fee,
      max(has_metadata)  AS has_metadata
    FROM (
      SELECT key AS token_id, value AS native_amount,
             NULL AS network_fee, 0 AS has_metadata
        FROM tx_chain c, json_each(c.doc, '$.nativeAmounts')
       WHERE c.wallet_id = ${wallet} AND c.txid = ${txid}
      UNION ALL
      SELECT key, NULL, value, 0
        FROM tx_chain c, json_each(c.doc, '$.networkFees')
       WHERE c.wallet_id = ${wallet} AND c.txid = ${txid}
      UNION ALL
      SELECT key, NULL, NULL,
             CASE WHEN value ->> '$.metadata.name'     IS NOT NULL
                    OR value ->> '$.metadata.notes'    IS NOT NULL
                    OR value ->> '$.metadata.category' IS NOT NULL
                    OR value ->> '$.metadata.bizId'    IS NOT NULL
                  THEN 1 ELSE 0 END
        FROM tx_meta m, json_each(m.doc, '$.tokens')
       WHERE m.wallet_id = ${wallet} AND m.txid = ${txid}
    )
    GROUP BY token_id`
}

/**
 * Rebuilds every satellite row for one transaction, from whichever documents
 * currently exist.
 *
 * Recomputing the whole set rather than patching it is what makes the six
 * triggers below correct without six different bodies. An update that drops an
 * asset, a delete that leaves metadata behind as an orphan, and a first insert
 * are all the same operation from here.
 */
export function reindexTransaction(wallet: string, txid: string): string[] {
  return [
    `DELETE FROM tx_asset_idx
      WHERE wallet_id = ${wallet} AND txid = ${txid};`,

    `INSERT INTO tx_asset_idx (
       wallet_id, txid, token_id,
       has_chain, has_meta, effective_date,
       plugin_id, block_height, is_send,
       native_amount_key, network_fee_key, has_metadata
     )
     SELECT
       ${wallet}, ${txid}, asset.token_id,
       chain.txid IS NOT NULL,
       meta.txid IS NOT NULL,
       min(
         coalesce(chain.date, meta.creation_date),
         coalesce(meta.creation_date, chain.date)
       ),
       chain.plugin_id, chain.block_height, chain.is_send,
       edge_native_amount_key(asset.native_amount),
       edge_native_amount_key(asset.network_fee),
       asset.has_metadata
     FROM (${assetUnion(wallet, txid)}) asset
     LEFT JOIN tx_chain chain
            ON chain.wallet_id = ${wallet} AND chain.txid = ${txid}
     LEFT JOIN tx_meta meta
            ON meta.wallet_id = ${wallet} AND meta.txid = ${txid};`
  ]
}

function makeTrigger(
  name: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  table: 'tx_chain' | 'tx_meta'
): string {
  const row = event === 'DELETE' ? 'OLD' : 'NEW'
  const body = reindexTransaction(`${row}.wallet_id`, `${row}.txid`)
  return `
CREATE TRIGGER ${name} AFTER ${event} ON ${table} BEGIN
  ${body.join('\n  ')}
END;`
}

const triggers = [
  makeTrigger('tx_chain_ins_idx', 'INSERT', 'tx_chain'),
  makeTrigger('tx_chain_upd_idx', 'UPDATE', 'tx_chain'),
  makeTrigger('tx_chain_del_idx', 'DELETE', 'tx_chain'),
  makeTrigger('tx_meta_ins_idx', 'INSERT', 'tx_meta'),
  makeTrigger('tx_meta_upd_idx', 'UPDATE', 'tx_meta'),
  makeTrigger('tx_meta_del_idx', 'DELETE', 'tx_meta')
].join('\n')

/** The statements that build a fresh database, in order. */
export const schemaStatements: string[] = [documentTables, assetIndex, triggers]

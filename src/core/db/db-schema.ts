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

-- Which version of its rebuild SQL each derived table was last built with.
-- Not derived itself: it is the record of what the derived tables are, so
-- losing it would mean rebuilding all of them.
CREATE TABLE index_version (
  name    TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL
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
 *
 * `scope` narrows this to one transaction, which is what the triggers want.
 * Without it the same SQL covers every transaction in the database, which is
 * what a reindex wants -- and the two cannot drift, because there is only one
 * of them.
 */
function assetRows(scope?: ReindexScope): string {
  const chainWhere =
    scope == null
      ? ''
      : `WHERE c.wallet_id = ${scope.wallet} AND c.txid = ${scope.txid}`
  const metaWhere =
    scope == null
      ? ''
      : `WHERE m.wallet_id = ${scope.wallet} AND m.txid = ${scope.txid}`

  return `
    SELECT
      wallet_id, txid, token_id,
      max(native_amount) AS native_amount,
      max(network_fee)   AS network_fee,
      max(has_metadata)  AS has_metadata
    FROM (
      SELECT c.wallet_id, c.txid, key AS token_id, value AS native_amount,
             NULL AS network_fee, 0 AS has_metadata
        FROM tx_chain c, json_each(c.doc, '$.nativeAmounts')
       ${chainWhere}
      UNION ALL
      SELECT c.wallet_id, c.txid, key, NULL, value, 0
        FROM tx_chain c, json_each(c.doc, '$.networkFees')
       ${chainWhere}
      UNION ALL
      SELECT m.wallet_id, m.txid, key, NULL, NULL,
             CASE WHEN value ->> '$.metadata.name'     IS NOT NULL
                    OR value ->> '$.metadata.notes'    IS NOT NULL
                    OR value ->> '$.metadata.category' IS NOT NULL
                    OR value ->> '$.metadata.bizId'    IS NOT NULL
                  THEN 1 ELSE 0 END
        FROM tx_meta m, json_each(m.doc, '$.tokens')
       ${metaWhere}
    )
    GROUP BY wallet_id, txid, token_id`
}

/** One transaction, named by whatever expressions the caller has to hand. */
interface ReindexScope {
  wallet: string
  txid: string
}

/**
 * Rebuilds satellite rows from whichever documents currently exist.
 *
 * Recomputing the whole set rather than patching it is what makes the six
 * triggers below correct without six different bodies. An update that drops an
 * asset, a delete that leaves metadata behind as an orphan, and a first insert
 * are all the same operation from here -- and so is rebuilding the entire
 * table, which is the same SQL with the scope left off.
 */
export function reindexAssets(scope?: ReindexScope): string[] {
  const clear =
    scope == null
      ? 'DELETE FROM tx_asset_idx;'
      : `DELETE FROM tx_asset_idx
          WHERE wallet_id = ${scope.wallet} AND txid = ${scope.txid};`

  return [
    clear,
    `INSERT INTO tx_asset_idx (
       wallet_id, txid, token_id,
       has_chain, has_meta, effective_date,
       plugin_id, block_height, is_send,
       native_amount_key, network_fee_key, has_metadata
     )
     SELECT
       asset.wallet_id, asset.txid, asset.token_id,
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
     FROM (${assetRows(scope)}) asset
     LEFT JOIN tx_chain chain
            ON chain.wallet_id = asset.wallet_id AND chain.txid = asset.txid
     LEFT JOIN tx_meta meta
            ON meta.wallet_id = asset.wallet_id AND meta.txid = asset.txid;`
  ]
}

/**
 * Search over the user's own words.
 *
 * Two objects, not one. `tx_search_idx` holds the text, keyed by transaction,
 * so a metadata edit deletes its old row by primary key. `tx_search_fts_idx`
 * is the FTS5 index over it, maintained by the external-content triggers FTS5
 * documents -- because FTS5's own columns cannot be deleted by anything but a
 * rowid, and finding the rowid for a transaction would mean scanning the whole
 * index on every write.
 *
 * The tokenizer is `trigram`, which matches anywhere inside a word rather than
 * only at its start. That is what users expect of a search box, and it is why
 * a query shorter than three characters cannot use the index at all -- those
 * fall back to `LIKE` over the text table.
 */
const searchIndex = `
CREATE TABLE tx_search_idx (
  wallet_id TEXT NOT NULL,
  txid      TEXT NOT NULL,
  name      TEXT,
  notes     TEXT,
  category  TEXT,
  PRIMARY KEY (wallet_id, txid)
);

CREATE VIRTUAL TABLE tx_search_fts_idx USING fts5(
  name, notes, category,
  content = 'tx_search_idx',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

CREATE TRIGGER tx_search_ins_fts AFTER INSERT ON tx_search_idx BEGIN
  INSERT INTO tx_search_fts_idx (rowid, name, notes, category)
  VALUES (new.rowid, new.name, new.notes, new.category);
END;

CREATE TRIGGER tx_search_del_fts AFTER DELETE ON tx_search_idx BEGIN
  INSERT INTO tx_search_fts_idx (tx_search_fts_idx, rowid, name, notes, category)
  VALUES ('delete', old.rowid, old.name, old.notes, old.category);
END;

CREATE TRIGGER tx_search_upd_fts AFTER UPDATE ON tx_search_idx BEGIN
  INSERT INTO tx_search_fts_idx (tx_search_fts_idx, rowid, name, notes, category)
  VALUES ('delete', old.rowid, old.name, old.notes, old.category);
  INSERT INTO tx_search_fts_idx (rowid, name, notes, category)
  VALUES (new.rowid, new.name, new.notes, new.category);
END;
`

/**
 * Rebuilds the searchable text for a transaction.
 *
 * One row per transaction rather than per asset: a search returns
 * transactions, and a user who labelled one asset of a swap expects to find
 * the swap. `group_concat` skips NULLs, so an asset with no note contributes
 * nothing rather than a gap.
 */
export function reindexSearch(scope?: ReindexScope): string[] {
  const where =
    scope == null
      ? ''
      : `WHERE m.wallet_id = ${scope.wallet} AND m.txid = ${scope.txid}`
  const clear =
    scope == null
      ? 'DELETE FROM tx_search_idx;'
      : `DELETE FROM tx_search_idx
          WHERE wallet_id = ${scope.wallet} AND txid = ${scope.txid};`

  return [
    clear,
    `INSERT INTO tx_search_idx (wallet_id, txid, name, notes, category)
     SELECT
       m.wallet_id, m.txid,
       group_concat(j.value ->> '$.metadata.name', ' '),
       group_concat(j.value ->> '$.metadata.notes', ' '),
       group_concat(j.value ->> '$.metadata.category', ' ')
     FROM tx_meta m, json_each(m.doc, '$.tokens') j
     ${where}
     GROUP BY m.wallet_id, m.txid
     HAVING group_concat(j.value ->> '$.metadata.name', ' ') IS NOT NULL
         OR group_concat(j.value ->> '$.metadata.notes', ' ') IS NOT NULL
         OR group_concat(j.value ->> '$.metadata.category', ' ') IS NOT NULL;`
  ]
}

function makeTrigger(
  name: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  table: 'tx_chain' | 'tx_meta'
): string {
  const row = event === 'DELETE' ? 'OLD' : 'NEW'
  const scope = { wallet: `${row}.wallet_id`, txid: `${row}.txid` }
  const body = [
    ...reindexAssets(scope),
    // Only metadata carries words; chain data has none.
    ...(table === 'tx_meta' ? reindexSearch(scope) : [])
  ]
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
export const schemaStatements: string[] = [
  documentTables,
  assetIndex,
  searchIndex,
  triggers
]

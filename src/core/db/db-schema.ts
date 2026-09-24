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
export const SCHEMA_VERSION = 2

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

-- The account's own settings, as the database needs to see them.
--
-- Only the default fiat code so far, and it is here rather than only in the
-- core's memory, because the fiat materialization has to know which currency
-- a stored amount is in.
CREATE TABLE setting (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT
);

-- Currency codes and denominations, per asset, and the account's custom tokens.
--
-- The multiplier is what turns a native amount into a display one, and is the
-- missing term in every fiat calculation: a rate is quoted per whole coin, and
-- a native amount is in the chain's smallest unit.
--
-- A custom token is a row with is_custom set and its three custom columns
-- filled, so this is the one answer to "what assets exist". A row can be both
-- at once -- the running plugins record every token they know, custom ones
-- included -- which is why removing a custom token clears the flag and those
-- columns rather than deleting the row.
--
-- This is also the one core table a plugin may read, since plugins need
-- currency codes and denominations of their own.
CREATE TABLE token (
  plugin_id        TEXT NOT NULL,
  token_id         TEXT NOT NULL,      -- '' is the chain's own asset
  currency_code    TEXT NOT NULL,
  multiplier       TEXT NOT NULL,      -- '100000000' for BTC
  display_name     TEXT,
  denominations    TEXT CONSTRAINT token_denominations_json
                   CHECK (denominations IS NULL OR json_valid(denominations)),
  network_location TEXT CONSTRAINT token_network_location_json
                   CHECK (network_location IS NULL OR json_valid(network_location)),
  is_custom        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plugin_id, token_id)
);

-- One row per wallet the account knows anything about.
--
-- The prefix column is what names that wallet's plugin tables. The wallet is
-- in the table name rather than in a column, so this is the only place a
-- prefix can be mapped back to a wallet -- which someone reading the schema
-- during support will want.
--
-- The rest is the wallet's boot state: what the account shows for it before
-- its engine exists. cached is the one word for "this row can seed a
-- wallet", and is set only in the transaction that writes every column a seed
-- needs -- a row that plugin tables or a wallet state created has it clear.
--
-- wallet_state is the account's EdgeWalletState for this wallet, and NULL
-- means the account has none, which is most wallets. plugin_id is NULL when
-- no loaded plugin claims the wallet's type, which is how a removed coin's
-- archived wallet still keeps its state.
CREATE TABLE wallet (
  wallet_id          TEXT NOT NULL PRIMARY KEY,
  prefix             TEXT NOT NULL UNIQUE,
  plugin_id          TEXT,
  table_version      INTEGER,
  cached             INTEGER NOT NULL DEFAULT 0,
  wallet_info        TEXT CONSTRAINT wallet_info_json
                     CHECK (wallet_info IS NULL OR json_valid(wallet_info)),
  name               TEXT,
  fiat_code          TEXT,
  enabled_token_ids  TEXT CONSTRAINT enabled_token_ids_json
                     CHECK (enabled_token_ids IS NULL OR json_valid(enabled_token_ids)),
  other_method_names TEXT CONSTRAINT other_method_names_json
                     CHECK (other_method_names IS NULL OR json_valid(other_method_names)),
  staking_status     TEXT CONSTRAINT staking_status_json
                     CHECK (staking_status IS NULL OR json_valid(staking_status)),
  wallet_state       TEXT CONSTRAINT wallet_state_json
                     CHECK (wallet_state IS NULL OR json_valid(wallet_state)),
  meta_mirrored      INTEGER NOT NULL DEFAULT 0
);

-- A wallet's balances, one row per asset.
--
-- One row per asset is the point: a balance arriving for one token is one
-- update of one row, not a rewrite of every balance the account holds.
CREATE TABLE wallet_balance (
  wallet_id     TEXT NOT NULL,
  token_id      TEXT NOT NULL,      -- '' is the chain's own asset
  native_amount TEXT NOT NULL,
  PRIMARY KEY (wallet_id, token_id)
);

-- A wallet's receive addresses, per asset, in the order the engine gave them.
--
-- The order is the contract -- the GUI takes the first address as the receive
-- address -- so it is kept in ordinal and is also the key, which leaves an
-- engine free to report two addresses of the same type.
CREATE TABLE wallet_address (
  wallet_id      TEXT NOT NULL,
  token_id       TEXT NOT NULL,     -- '' is the chain's own asset
  ordinal        INTEGER NOT NULL,
  address_type   TEXT NOT NULL,
  public_address TEXT NOT NULL,
  PRIMARY KEY (wallet_id, token_id, ordinal)
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
 * The only door a plugin has onto the core's transactions.
 *
 * `edge_wallet()` is a native function returning the wallet the current call
 * is scoped to, so the wallet id never comes from the plugin's SQL. The view
 * filters reads; the INSTEAD OF triggers substitute the wallet on write. A
 * plugin cannot reach another wallet's rows even by naming them, because it
 * has no way to name them.
 *
 * The trigger names matter: the authorizer allows `edge_wallet()` only inside
 * an object whose name starts `tx_chain_scoped`, so renaming one would get it
 * denied by the fence it exists to satisfy.
 */
const scopedView = `
CREATE VIEW tx_chain_scoped AS
  SELECT * FROM tx_chain WHERE wallet_id = edge_wallet();

CREATE TRIGGER tx_chain_scoped_ins INSTEAD OF INSERT ON tx_chain_scoped
BEGIN
  INSERT INTO tx_chain (wallet_id, txid, doc)
  VALUES (edge_wallet(), NEW.txid, NEW.doc)
  ON CONFLICT (wallet_id, txid)
  DO UPDATE SET doc = jsonb_patch(doc, excluded.doc);
END;

CREATE TRIGGER tx_chain_scoped_upd INSTEAD OF UPDATE ON tx_chain_scoped
BEGIN
  UPDATE tx_chain SET doc = NEW.doc
   WHERE wallet_id = edge_wallet() AND txid = OLD.txid;
END;

CREATE TRIGGER tx_chain_scoped_del INSTEAD OF DELETE ON tx_chain_scoped
BEGIN
  DELETE FROM tx_chain
   WHERE wallet_id = edge_wallet() AND txid = OLD.txid;
END;
`

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
  triggers,
  scopedView
]

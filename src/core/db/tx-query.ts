import {
  EdgeAccountTxPage,
  EdgeAccountTxQuery,
  EdgeAccountTxSummary,
  EdgeTx
} from '../../types/types'
import { EdgeSqlDriver, EdgeSqlValue } from './db-driver'
import { asEdgeTx } from './tx-cleaners'
import { mergeTxMeta } from './tx-meta-merge'

/**
 * The account-wide transaction query.
 *
 * Every query is answered from `tx_asset_idx`, whose grain is one row per
 * (wallet, transaction, asset). Callers want transactions, so the rows are
 * collapsed on the way out -- a transaction that moved two assets is one
 * `EdgeTx`, not two.
 *
 * One consequence: **a page can return fewer transactions than `limit`**,
 * because the limit applies to index rows. `cursor` is what signals
 * exhaustion, never the count.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/** The columns a sort can name, and the index column each one reads. */
const SORT_COLUMNS = {
  date: 'effective_date',
  nativeAmount: 'native_amount_key',
  networkFee: 'network_fee_key',
  fiatAmount: 'fiat_amount',
  blockHeight: 'block_height'
} as const

/**
 * Every sort column but the date can be NULL, and SQLite puts NULL first
 * ascending and last descending -- so the same query would order unknowns
 * differently depending on the direction, silently.
 *
 * Rather than pick a side, a sort on one of these drops the unknowns. An
 * amount sort that lists transactions whose amount is not known is not
 * answering the question, and a fee-only asset row genuinely has no amount to
 * be ranked by. It also keeps the keyset cursor sound: a row-value comparison
 * against NULL yields NULL, so paging would stop dead at the boundary.
 */
const NULLABLE_SORTS = new Set([
  'native_amount_key',
  'network_fee_key',
  'fiat_amount',
  'block_height'
])

interface PageRow {
  wallet_id: string
  txid: string
  token_id: string
  sort_key: EdgeSqlValue
  effective_date: number
  fiat_amount: number | null
  chain_doc: string | null
  meta_doc: string | null
}

interface WhereClause {
  sql: string
  params: EdgeSqlValue[]
}

/**
 * A position in a result set.
 *
 * Opaque to callers, and deliberately not an offset: an offset shifts under
 * inserts, so a transaction arriving mid-scroll would make the reader skip a
 * row or see one twice. This names the last row instead, so the next page
 * starts exactly after it however much has changed.
 *
 * It carries the sort that produced it, and a query whose sort does not match
 * is rejected rather than silently paged wrong.
 */
interface Cursor {
  sort: string
  direction: 'asc' | 'desc'
  /** The last row's sort value, txid and token, in index order. */
  key: [EdgeSqlValue, string, string]
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

function decodeCursor(text: string): Cursor {
  try {
    return JSON.parse(Buffer.from(text, 'base64').toString('utf8'))
  } catch (error) {
    throw new TypeError('Invalid transaction query cursor')
  }
}

/** `EdgeTokenId` is `null` for the chain's own asset; SQL spells that `''`. */
function toTokenKey(tokenId: string | null): string {
  return tokenId == null ? '' : tokenId
}

/**
 * `alias` qualifies every column, because the page query joins the index
 * against `tx_chain` and the two share most of their column names.
 */
function buildWhere(query: EdgeAccountTxQuery, alias = ''): WhereClause {
  const parts: string[] = []
  const params: EdgeSqlValue[] = []
  const at = (column: string): string => `${alias}${column}`

  const inList = (column: string, values: EdgeSqlValue[]): void => {
    if (values.length === 0) {
      // An empty scope matches nothing, which is not the same as no scope.
      parts.push('0')
      return
    }
    parts.push(`${column} IN (${values.map(() => '?').join(', ')})`)
    params.push(...values)
  }

  if (query.walletIds != null) inList(at('wallet_id'), query.walletIds)
  if (query.pluginIds != null) inList(at('plugin_id'), query.pluginIds)
  if (query.txids != null) inList(at('txid'), query.txids)
  if (query.tokenIds != null) {
    inList(at('token_id'), query.tokenIds.map(toTokenKey))
  }
  if (query.assets != null) {
    if (query.assets.length === 0) {
      parts.push('0')
    } else {
      parts.push(
        `(${query.assets
          .map(() => `(${at('plugin_id')} = ? AND ${at('token_id')} = ?)`)
          .join(' OR ')})`
      )
      for (const asset of query.assets) {
        params.push(asset.pluginId, toTokenKey(asset.tokenId))
      }
    }
  }

  if (query.direction != null) {
    parts.push(`${at('is_send')} = ?`)
    params.push(query.direction === 'send' ? 1 : 0)
  }
  if (query.afterDate != null) {
    parts.push(`${at('effective_date')} >= ?`)
    params.push(Math.floor(query.afterDate.valueOf() / 1000))
  }
  if (query.beforeDate != null) {
    parts.push(`${at('effective_date')} <= ?`)
    params.push(Math.floor(query.beforeDate.valueOf() / 1000))
  }

  // Amounts compare through the sort key, using the same function that wrote
  // the column -- so a bound and a stored value cannot be encoded differently.
  if (query.minNativeAmount != null) {
    parts.push(`${at('native_amount_key')} >= edge_native_amount_key(?)`)
    params.push(query.minNativeAmount)
  }
  if (query.maxNativeAmount != null) {
    parts.push(`${at('native_amount_key')} <= edge_native_amount_key(?)`)
    params.push(query.maxNativeAmount)
  }
  if (query.minNetworkFee != null) {
    parts.push(`${at('network_fee_key')} >= edge_native_amount_key(?)`)
    params.push(query.minNetworkFee)
  }
  if (query.maxNetworkFee != null) {
    parts.push(`${at('network_fee_key')} <= edge_native_amount_key(?)`)
    params.push(query.maxNetworkFee)
  }

  if (query.minFiatAmount != null) {
    parts.push(`${at('fiat_amount')} >= ?`)
    params.push(query.minFiatAmount)
  }
  if (query.maxFiatAmount != null) {
    parts.push(`${at('fiat_amount')} <= ?`)
    params.push(query.maxFiatAmount)
  }
  if (query.minBlockHeight != null) {
    parts.push(`${at('block_height')} >= ?`)
    params.push(query.minBlockHeight)
  }
  if (query.maxBlockHeight != null) {
    parts.push(`${at('block_height')} <= ?`)
    params.push(query.maxBlockHeight)
  }
  if (query.hasMetadata != null) {
    parts.push(`${at('has_metadata')} = ?`)
    params.push(query.hasMetadata ? 1 : 0)
  }

  if (query.searchString != null && query.searchString !== '') {
    parts.push(
      `(${at('wallet_id')}, ${at('txid')}) IN (${searchSubquery(
        query.searchString
      )})`
    )
    params.push(...searchParams(query.searchString))
  }

  // A row with metadata but no chain data yet is an orphan: the user
  // annotated a transaction this device has not seen. Hidden by default,
  // because showing one looks like a transaction that lost its amounts.
  if (query.includeOrphans !== true) parts.push(`${at('has_chain')} = 1`)

  return {
    sql: parts.length === 0 ? '1' : parts.join(' AND '),
    params
  }
}

/**
 * The transactions matching a search string.
 *
 * The trigram tokenizer indexes three characters at a time, so it cannot
 * answer a query shorter than that at all. Those fall back to `LIKE` over the
 * text table, which is a scan -- but of one small table holding only what the
 * user typed, not of every transaction document.
 */
function searchSubquery(search: string): string {
  if (search.length >= 3) {
    return `SELECT wallet_id, txid FROM tx_search_idx
             WHERE rowid IN (
               SELECT rowid FROM tx_search_fts_idx
                WHERE tx_search_fts_idx MATCH ?
             )`
  }
  return `SELECT wallet_id, txid FROM tx_search_idx
           WHERE name LIKE ?1 OR notes LIKE ?1 OR category LIKE ?1`
}

function searchParams(search: string): EdgeSqlValue[] {
  if (search.length >= 3) {
    // Quoted as an FTS5 string literal, so punctuation in a note cannot be
    // read as query syntax -- a search for "a-b" is a search, not an
    // expression with a NOT in it.
    return [`"${search.replace(/"/g, '""')}"`]
  }
  return [`%${search.replace(/[\\%_]/g, '\\$&')}%`]
}

/**
 * The one table a scan is allowed over.
 *
 * `tx_search_idx` holds one row per *annotated* transaction, carrying only
 * the words the user typed -- so it is a fraction of the size of the index it
 * sits beside, and scanning it is what lets a one- or two-character search
 * work at all. The trigram index cannot answer those, and refusing them
 * outright would be worse than a small scan.
 */
const SCANNABLE = new Set(['tx_search_idx'])

/**
 * Refuses a query no index can answer.
 *
 * A full table scan is a query that works in development and takes four
 * seconds on a real account, so it fails here instead. The fix is never to
 * loosen this: it is to add a column or a satellite table for the dimension,
 * and reindex.
 */
async function assertIndexed(
  driver: EdgeSqlDriver,
  sql: string,
  params: EdgeSqlValue[]
): Promise<void> {
  const plan = await driver.query<{ detail: string }>(
    `EXPLAIN QUERY PLAN ${sql}`,
    params
  )
  for (const { detail } of plan) {
    // "SCAN t USING INDEX i" is an ordered walk of an index, which is what
    // an unfiltered page looks like. A bare "SCAN t" is the table itself.
    const scan = /^SCAN (\w+)$/.exec(detail)
    if (scan != null && !SCANNABLE.has(scan[1])) {
      throw new Error(
        `This transaction query cannot use an index: ${detail}. ` +
          'Narrow it with a wallet, asset or date, or add an index for the ' +
          'dimension it asks about.'
      )
    }
  }
}

interface BuiltPage {
  sql: string
  params: EdgeSqlValue[]
  sortColumn: string
  direction: 'asc' | 'desc'
  limit: number
}

function buildPageQuery(query: EdgeAccountTxQuery): BuiltPage {
  const where = buildWhere(query, 'i.')
  const sortField = query.sort?.field ?? 'date'
  const direction = query.sort?.direction ?? 'desc'
  const sortColumn = SORT_COLUMNS[sortField]
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  const params = [...where.params]
  const sortable = NULLABLE_SORTS.has(sortColumn)
    ? ` AND i.${sortColumn} IS NOT NULL`
    : ''
  let keyset = ''
  if (query.after != null) {
    const cursor = decodeCursor(query.after)
    if (cursor.sort !== sortField || cursor.direction !== direction) {
      throw new Error(
        'This cursor belongs to a different sort. Start the query again.'
      )
    }
    // A row-value comparison, which SQLite turns into a seek on the same
    // index the ORDER BY uses rather than a filter over the whole range.
    const operator = direction === 'desc' ? '<' : '>'
    keyset = ` AND (i.${sortColumn}, i.txid, i.token_id) ${operator} (?, ?, ?)`
    params.push(...cursor.key)
  }

  const order = direction === 'desc' ? 'DESC' : 'ASC'
  const sql = `
    SELECT
      i.wallet_id, i.txid, i.token_id, i.effective_date,
      i.${sortColumn} AS sort_key,
      i.fiat_amount,
      json(c.doc) AS chain_doc,
      json(m.doc) AS meta_doc
    FROM tx_asset_idx i
    LEFT JOIN tx_chain c
           ON c.wallet_id = i.wallet_id AND c.txid = i.txid
    LEFT JOIN tx_meta m
           ON m.wallet_id = i.wallet_id AND m.txid = i.txid
    WHERE ${where.sql}${sortable}${keyset}
    ORDER BY i.${sortColumn} ${order}, i.txid ${order}, i.token_id ${order}
    LIMIT ?${query.offset != null ? ' OFFSET ?' : ''}`

  const tail: EdgeSqlValue[] =
    query.offset != null ? [limit, query.offset] : [limit]
  return { sql, params: [...params, ...tail], sortColumn, direction, limit }
}

/**
 * Collapses index rows into transactions.
 *
 * Rows for one transaction arrive adjacently under a date sort, but not under
 * an amount sort, so this keys a map rather than relying on adjacency --
 * while still returning them in the order the index produced.
 */
function collapse(rows: PageRow[]): EdgeTx[] {
  const out: EdgeTx[] = []
  const byKey = new Map<string, EdgeTx>()
  for (const row of rows) {
    const key = `${row.wallet_id}|${row.txid}`

    let tx = byKey.get(key)
    if (tx == null) {
      if (row.chain_doc == null) continue
      tx = asEdgeTx(JSON.parse(row.chain_doc))
      // What the user wrote, which is stored apart and belongs on the way
      // out -- a reader wants one transaction, not two halves of one.
      if (row.meta_doc != null) mergeTxMeta(tx, row.meta_doc)
      byKey.set(key, tx)
      out.push(tx)
    }

    /*
     * The fiat amount is per asset and lives on the index row, not in the
     * document -- so it is gathered as the rows collapse rather than read
     * back out of the transaction. An asset with no rate yet is left out
     * entirely, which is what makes "not yet known" distinguishable from
     * zero.
     */
    if (row.fiat_amount != null) {
      if (tx.fiatAmounts == null) tx.fiatAmounts = new Map()
      tx.fiatAmounts.set(
        row.token_id === '' ? null : row.token_id,
        row.fiat_amount
      )
    }
  }
  return out
}

async function readSummary(
  driver: EdgeSqlDriver,
  query: EdgeAccountTxQuery
): Promise<EdgeAccountTxSummary> {
  const where = buildWhere(query)
  const sql = `
    SELECT
      count(DISTINCT wallet_id || '|' || txid) AS count,
      min(effective_date) AS earliest,
      max(effective_date) AS latest
    FROM tx_asset_idx
    WHERE ${where.sql}`

  const rows = await driver.query<{
    count: number
    earliest: number | null
    latest: number | null
  }>(sql, where.params)

  const row = rows[0]
  const out: EdgeAccountTxSummary = { count: row?.count ?? 0 }
  if (row?.earliest != null) out.earliestDate = new Date(row.earliest * 1000)
  if (row?.latest != null) out.latestDate = new Date(row.latest * 1000)
  return out
}

/** Runs one page of a query. */
export async function queryTxPage(
  driver: EdgeSqlDriver,
  query: EdgeAccountTxQuery
): Promise<EdgeAccountTxPage> {
  const details = query.details ?? 'txs'

  const out: EdgeAccountTxPage = { transactions: [] }
  if (details !== 'summary') {
    const built = buildPageQuery(query)
    await assertIndexed(driver, built.sql, built.params)
    const rows = await driver.query<PageRow>(built.sql, built.params)

    out.transactions = collapse(rows)

    // Exhaustion is "the index had no more rows", not "we returned fewer
    // transactions than asked for" -- those differ whenever a transaction
    // touched more than one asset.
    if (rows.length === built.limit) {
      const last = rows[rows.length - 1]
      out.cursor = encodeCursor({
        sort: query.sort?.field ?? 'date',
        direction: built.direction,
        key: [last.sort_key, last.txid, last.token_id]
      })
    }
  }

  if (details !== 'txs') out.summary = await readSummary(driver, query)
  return out
}

/** Reads one transaction by identity. */
export async function readTx(
  driver: EdgeSqlDriver,
  walletId: string,
  txid: string
): Promise<EdgeTx | undefined> {
  const rows = await driver.query<{ doc: string; meta_doc: string | null }>(
    `SELECT json(c.doc) AS doc, json(m.doc) AS meta_doc
       FROM tx_chain c
       LEFT JOIN tx_meta m
              ON m.wallet_id = c.wallet_id AND m.txid = c.txid
      WHERE c.wallet_id = ? AND c.txid = ?`,
    [walletId, txid]
  )
  if (rows.length === 0) return undefined
  const out = asEdgeTx(JSON.parse(rows[0].doc))
  if (rows[0].meta_doc != null) mergeTxMeta(out, rows[0].meta_doc)
  return out
}

/**
 * Every page of a query, one after another.
 *
 * Paging by cursor rather than by offset means a transaction arriving while
 * the caller reads does not make it skip a row or see one twice.
 */
export async function* streamTxPages(
  driver: EdgeSqlDriver,
  query: EdgeAccountTxQuery
): AsyncIterableIterator<EdgeTx[]> {
  let after = query.after
  while (true) {
    const page = await queryTxPage(driver, {
      ...query,
      after,
      details: 'txs'
    })
    if (page.transactions.length > 0) yield page.transactions
    if (page.cursor == null) return
    after = page.cursor
  }
}

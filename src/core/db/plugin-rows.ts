import {
  EdgeTableDefinition,
  EdgeTableKeys,
  EdgeTableQuery,
  EdgeTableRows,
  EdgeTableSpec
} from '../../types/types'
import { EdgeSqlDriver, EdgeSqlStatement, EdgeSqlValue } from './db-driver'
import { tableName } from './plugin-tables'

/**
 * Reading and writing plugin-owned rows.
 *
 * Every call takes an **array of per-table requests**, because each one is a
 * bridge round trip: an engine that wants three addresses and two UTXOs
 * should pay for one crossing, not two.
 *
 * Results come back in request order, and each `rows` array is aligned to the
 * `keys` that produced it, with `undefined` where a key was absent. So a
 * caller can zip the answer against its own input, and learns *which* keys
 * were missing rather than only how many.
 */

/**
 * Joins a composite key.
 *
 * A unit separator, because it cannot appear in a JSON string value that came
 * through a cleaner -- so no pair of field values can collide into one key.
 */
const KEY_SEPARATOR = ''

function tableDefinition(
  spec: EdgeTableSpec,
  table: string
): EdgeTableDefinition {
  const definition = spec.tables[table]
  if (definition == null) throw new Error(`No such table: ${table}`)
  return definition
}

/** The key a document belongs under, from the table's declared key fields. */
export function rowKey(definition: EdgeTableDefinition, row: unknown): string {
  const record = row as { [field: string]: unknown }
  const parts = definition.key.map(field => {
    const value = record?.[field]
    if (value == null) {
      throw new TypeError(`This row has no ${field}: ${JSON.stringify(row)}`)
    }
    return String(value)
  })
  return parts.join(KEY_SEPARATOR)
}

/** Reads rows by key, across as many tables as one call needs. */
export async function getRows(
  driver: EdgeSqlDriver,
  prefix: string,
  spec: EdgeTableSpec,
  requests: EdgeTableKeys[]
): Promise<EdgeTableRows[]> {
  const out: EdgeTableRows[] = []

  for (const request of requests) {
    tableDefinition(spec, request.table)
    const name = tableName(prefix, request.table)

    if (request.keys.length === 0) {
      out.push({ table: request.table, rows: [] })
      continue
    }

    const rows = await driver.query<{ key: string; doc: string }>(
      `SELECT key, json(doc) AS doc FROM "${name}"
        WHERE key IN (${request.keys.map(() => '?').join(', ')})`,
      request.keys
    )

    // Aligned to the request, not to what came back: a caller zipping these
    // against its own input has to be able to trust the positions.
    const found = new Map(rows.map(row => [row.key, JSON.parse(row.doc)]))
    out.push({
      table: request.table,
      rows: request.keys.map(key => found.get(key))
    })
  }

  return out
}

/** The statements `putRows` runs, for callers composing an atomic batch. */
export function putRowStatements(
  prefix: string,
  spec: EdgeTableSpec,
  writes: EdgeTableRows[]
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []
  for (const write of writes) {
    const definition = tableDefinition(spec, write.table)
    const name = tableName(prefix, write.table)
    for (const row of write.rows) {
      out.push({
        sql: `INSERT INTO "${name}" (key, doc) VALUES (?, jsonb(?))
              ON CONFLICT (key) DO UPDATE SET doc = excluded.doc`,
        params: [rowKey(definition, row), JSON.stringify(row)]
      })
    }
  }
  return out
}

/**
 * Writes rows, replacing whatever was under each key.
 *
 * Replace rather than merge: a plugin owns its own documents whole, and has
 * the previous one to hand if it wanted to merge. `tx_chain` merges because
 * one transaction arrives once per asset; nothing here does.
 */
export async function putRows(
  driver: EdgeSqlDriver,
  prefix: string,
  spec: EdgeTableSpec,
  writes: EdgeTableRows[]
): Promise<void> {
  const statements = putRowStatements(prefix, spec, writes)
  if (statements.length > 0) await driver.batch(statements)
}

/** The statements `removeRows` runs, for callers composing an atomic batch. */
export function removeRowStatements(
  prefix: string,
  spec: EdgeTableSpec,
  removals: EdgeTableKeys[]
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []
  for (const removal of removals) {
    tableDefinition(spec, removal.table)
    if (removal.keys.length === 0) continue
    out.push({
      sql: `DELETE FROM "${tableName(prefix, removal.table)}"
             WHERE key IN (${removal.keys.map(() => '?').join(', ')})`,
      params: removal.keys
    })
  }
  return out
}

export async function removeRows(
  driver: EdgeSqlDriver,
  prefix: string,
  spec: EdgeTableSpec,
  removals: EdgeTableKeys[]
): Promise<void> {
  const statements = removeRowStatements(prefix, spec, removals)
  if (statements.length > 0) await driver.batch(statements)
}

function assertPath(path: string): string {
  if (!path.startsWith('$.')) {
    throw new Error(`A document path must start with "$.": ${path}`)
  }
  return `doc ->> '${path.replace(/'/g, "''")}'`
}

/**
 * An indexed query over one table.
 *
 * Single-table on purpose: a query names one table's indexes, and a
 * cross-table question is what `runSql` is for.
 *
 * A query no index can answer is refused rather than quietly scanning, for
 * the same reason the account-wide query refuses one -- a plugin with 20,000
 * addresses finds out during development instead of in production.
 */
export async function findRows(
  driver: EdgeSqlDriver,
  prefix: string,
  spec: EdgeTableSpec,
  table: string,
  query: EdgeTableQuery
): Promise<unknown[]> {
  tableDefinition(spec, table)
  const name = tableName(prefix, table)

  const parts: string[] = []
  const params: EdgeSqlValue[] = []

  for (const path of Object.keys(query.equals ?? {})) {
    parts.push(`${assertPath(path)} = ?`)
    params.push((query.equals ?? {})[path])
  }
  if (query.range != null) {
    const column = assertPath(query.range.path)
    if (query.range.min != null) {
      parts.push(`${column} >= ?`)
      params.push(query.range.min)
    }
    if (query.range.max != null) {
      parts.push(`${column} <= ?`)
      params.push(query.range.max)
    }
  }

  const order = (query.orderBy ?? [])
    .map(
      ({ path, direction = 'asc' }) =>
        `${assertPath(path)} ${direction === 'desc' ? 'DESC' : 'ASC'}`
    )
    .join(', ')

  const sql =
    `SELECT json(doc) AS doc FROM "${name}"` +
    (parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '') +
    (order !== '' ? ` ORDER BY ${order}` : '') +
    (query.limit != null ? ' LIMIT ?' : '')
  if (query.limit != null) params.push(query.limit)

  // A query with no predicate is asking for the table. A scan is the only
  // plan there is, so refusing it would be refusing the question rather than
  // catching a mistake -- and reading one wallet's own UTXOs is exactly what
  // computing a spendable balance does.
  if (parts.length > 0) {
    const plan = await driver.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${sql}`,
      params
    )
    for (const { detail } of plan) {
      if (/^SCAN \w+$/.test(detail)) {
        throw new Error(
          `This query cannot use an index on ${table}: ${detail}. ` +
            'Declare an index for it in defineTables.'
        )
      }
    }
  }

  const rows = await driver.query<{ doc: string }>(sql, params)
  return rows.map(row => JSON.parse(row.doc))
}

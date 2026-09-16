import { base64 } from 'rfc4648'

import { EdgeTableSpec } from '../../types/types'
import { base58 } from '../../util/encoding'
import { EdgeSqlDriver, EdgeSqlStatement } from './db-driver'

/**
 * Plugin-owned tables.
 *
 * **The wallet is in the table name, so there is no wallet column.** A wallet
 * id repeated in every row and every index of a 20,000-address table inflates
 * it by about 160%, and even an integer surrogate costs about 7% plus a
 * mapping to maintain. One table per wallet per declared name pays neither.
 *
 * Two things follow, and both are simplifications. Fencing a plugin becomes a
 * name check -- there is no wallet column to constrain and no scoped view to
 * write. And deleting a wallet becomes `DROP TABLE` rather than a large
 * `DELETE` competing with live readers for the write lock.
 *
 * What it costs is schema size: a 194-wallet account reaches roughly 1,550
 * schema objects. That is the trade.
 */

/** How many characters of the wallet id normally name a table. */
const PREFIX_LENGTH = 8

/** A plugin never writes a table name; the core resolves one from the scope. */
export function tableName(prefix: string, table: string): string {
  return `${prefix}${table}`
}

/**
 * The prefix naming one wallet's tables.
 *
 * base58 of the wallet id, the same encoding the database file is named with,
 * so a table and its file are recognisably the same wallet.
 *
 * `taken` is every prefix already in use. Eight characters of base58 is 47
 * bits, so a clash is astronomically unlikely -- but the core knows every
 * wallet id in the account, so it costs nothing to lengthen the prefix rather
 * than let two wallets share a table.
 */
export function walletTablePrefix(
  walletId: string,
  taken: Iterable<string> = []
): string {
  const full = base58.stringify(base64.parse(walletId))
  const used = new Set(taken)

  for (let length = PREFIX_LENGTH; length <= full.length; ++length) {
    const prefix = `p_${full.slice(0, length)}_`
    if (!used.has(prefix)) return prefix
  }
  throw new Error(`Cannot find a free table prefix for wallet ${walletId}`)
}

/** Reads a document path as SQL. Paths are `$.`-rooted, as JSON1 spells them. */
function pathExpression(path: string): string {
  const quoted = path.replace(/'/g, "''")
  return `doc ->> '${quoted}'`
}

/**
 * Validates a name the core is about to interpolate into DDL.
 *
 * Table and index names cannot be bound as parameters, so they are checked
 * against a character set instead of escaped. A plugin supplies these.
 */
function assertSafeName(name: string, what: string): void {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid ${what} name: ${JSON.stringify(name)}`)
  }
}

function assertSafePath(path: string): void {
  if (!path.startsWith('$.')) {
    throw new Error(`An index path must start with "$.": ${path}`)
  }
}

/** The statements that create one wallet's tables from a declaration. */
export function defineTableStatements(
  prefix: string,
  spec: EdgeTableSpec
): EdgeSqlStatement[] {
  const out: EdgeSqlStatement[] = []

  for (const table of Object.keys(spec.tables)) {
    assertSafeName(table, 'table')
    const definition = spec.tables[table]
    const name = tableName(prefix, table)

    if (definition.key.length === 0) {
      throw new Error(`Table ${table} declares no key`)
    }
    for (const path of definition.key) assertSafeName(path, 'key field')

    // The key is a stored column rather than a generated one, because SQLite
    // will not accept a generated column in a PRIMARY KEY. The core fills it
    // from the document on every write, so the two cannot diverge.
    out.push({
      sql: `CREATE TABLE IF NOT EXISTS "${name}" (
              key TEXT NOT NULL,
              doc BLOB NOT NULL,
              PRIMARY KEY (key)
            )`
    })

    const indexes = definition.indexes ?? {}
    for (const index of Object.keys(indexes)) {
      assertSafeName(index, 'index')
      const { paths, unique = false } = indexes[index]
      if (paths.length === 0) {
        throw new Error(`Index ${index} on ${table} names no paths`)
      }
      for (const path of paths) assertSafePath(path)

      out.push({
        sql: `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS
                "${name}_${index.toLowerCase()}_idx"
                ON "${name}" (${paths.map(pathExpression).join(', ')})`
      })
    }
  }

  return out
}

/** The tables a prefix owns, read from the database's own catalog. */
async function existingTables(
  driver: EdgeSqlDriver,
  prefix: string
): Promise<string[]> {
  const rows = await driver.query<{ name: string }>(
    `SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE ? ESCAPE '\\'`,
    [`${prefix.replace(/[%_]/g, '\\$&')}%`]
  )
  return rows.map(row => row.name)
}

export interface DefineTablesResult {
  prefix: string
  /** True when a version change dropped the wallet's tables. */
  rebuilt: boolean
}

/**
 * Creates one wallet's tables, the first time that wallet's engine starts.
 *
 * A version change **drops the wallet's tables and recreates them empty**. The
 * core cannot migrate a document shape it does not understand, and a plugin
 * that changed its storage can always refill it from the chain -- so losing
 * the cache is the honest outcome, and the return value says it happened.
 *
 * Creating a wallet issues DDL against a live database. SQLite re-prepares
 * cached statements transparently when the schema changes, so this is safe
 * while other wallets are reading.
 */
export async function defineTables(
  driver: EdgeSqlDriver,
  opts: {
    walletId: string
    pluginId: string
    spec: EdgeTableSpec
  }
): Promise<DefineTablesResult> {
  const { walletId, pluginId, spec } = opts

  const rows = await driver.query<{
    wallet_id: string
    prefix: string
    table_version: number | null
  }>('SELECT wallet_id, prefix, table_version FROM wallet')

  const mine = rows.find(row => row.wallet_id === walletId)
  const prefix =
    mine?.prefix ??
    walletTablePrefix(
      walletId,
      rows.map(row => row.prefix)
    )

  const rebuilt = mine != null && mine.table_version !== spec.version
  const statements: EdgeSqlStatement[] = []

  if (rebuilt) {
    for (const name of await existingTables(driver, prefix)) {
      statements.push({ sql: `DROP TABLE IF EXISTS "${name}"` })
    }
  }

  statements.push(...defineTableStatements(prefix, spec), {
    sql: `INSERT INTO wallet (wallet_id, prefix, plugin_id, table_version)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (wallet_id) DO UPDATE SET
              plugin_id = excluded.plugin_id,
              table_version = excluded.table_version`,
    params: [walletId, prefix, pluginId, spec.version]
  })

  await driver.batch(statements)
  return { prefix, rebuilt }
}

/** Removes every table a wallet owns, for wallet deletion. */
export async function dropWalletTables(
  driver: EdgeSqlDriver,
  walletId: string
): Promise<void> {
  const rows = await driver.query<{ prefix: string }>(
    'SELECT prefix FROM wallet WHERE wallet_id = ?',
    [walletId]
  )
  if (rows.length === 0) return

  const names = await existingTables(driver, rows[0].prefix)
  await driver.batch([
    ...names.map(name => ({ sql: `DROP TABLE IF EXISTS "${name}"` })),
    { sql: 'DELETE FROM wallet WHERE wallet_id = ?', params: [walletId] }
  ])
}

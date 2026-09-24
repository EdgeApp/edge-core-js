import { EdgeSqlDriver } from './db-driver'
import { derivedTables } from './db-index'
import { SCHEMA_VERSION, schemaStatements } from './db-schema'
import { RATE_DATABASE_NAME } from './rate-cache'

/** The device's plugin-scoped database, shared by every account. */
export const PLUGIN_DATABASE_NAME = 'plugins'

/**
 * The databases a driver may open without a key.
 *
 * Unkeyed is a refusal by default, because a file with no key would be a
 * plaintext account database -- the one mistake the codec cannot catch. These
 * two are named exceptions: both are device-wide and hold nothing private,
 * and a device-scoped key has no home on half the platforms.
 */
export const UNKEYED_DATABASE_NAMES = [RATE_DATABASE_NAME, PLUGIN_DATABASE_NAME]

/**
 * What `prepareDatabase` had to do to bring a connection up to the current
 * schema. Returned so the caller can log it, and so tests can assert on it.
 */
export type EdgePrepareResult = 'created' | 'reused' | 'rebuilt'

/**
 * Brings a freshly-opened connection up to the current schema.
 *
 * Every table is rebuildable -- `tx_meta` from the sync repo and `tx_chain`
 * from a network resync -- so a schema change never needs a migration.
 * Anything not at `SCHEMA_VERSION` is dropped and recreated, which is both
 * simpler and less risky than migrating storage that can be reconstructed.
 */
export async function prepareDatabase(
  driver: EdgeSqlDriver
): Promise<EdgePrepareResult> {
  const version = await readSchemaVersion(driver)
  if (version === SCHEMA_VERSION) return 'reused'

  const fresh = version === 0 && (await countSchemaObjects(driver)) === 0
  if (!fresh) await dropAllObjects(driver)

  await driver.batch([
    ...schemaStatements.map(sql => ({ sql })),
    // A schema built from scratch is already at every derived table's current
    // version, so record that rather than making the next step rebuild empty
    // tables and report it as a reindex.
    ...derivedTables.map(table => ({
      sql: 'INSERT INTO index_version (name, version) VALUES (?, ?)',
      params: [table.name, table.version]
    })),
    { sql: `PRAGMA user_version = ${SCHEMA_VERSION}` }
  ])

  return fresh ? 'created' : 'rebuilt'
}

async function readSchemaVersion(driver: EdgeSqlDriver): Promise<number> {
  const rows = await driver.query<{ user_version: number }>(
    'PRAGMA user_version'
  )
  return rows[0]?.user_version ?? 0
}

async function countSchemaObjects(driver: EdgeSqlDriver): Promise<number> {
  const rows = await driver.query<{ count: number }>(
    `SELECT count(*) count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'`
  )
  return rows[0]?.count ?? 0
}

/**
 * Drops every object this package created. Triggers go first, so that
 * dropping a table cannot fire one against a table that is already gone.
 */
async function dropAllObjects(driver: EdgeSqlDriver): Promise<void> {
  const rows = await driver.query<{ type: string; name: string }>(
    `SELECT type, name FROM sqlite_schema
      WHERE type IN ('trigger', 'index', 'view', 'table')
        AND name NOT LIKE 'sqlite_%'`
  )
  const order = ['trigger', 'index', 'view', 'table']
  const sorted = [...rows].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type)
  )

  await driver.batch(
    sorted.map(row => ({
      // Identifiers cannot be bound, and these names come from the database's
      // own catalog rather than from anything a caller supplied.
      sql: `DROP ${row.type.toUpperCase()} IF EXISTS "${row.name}"`
    }))
  )
}

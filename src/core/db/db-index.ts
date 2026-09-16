import { EdgeSqlDriver } from './db-driver'
import { reindexAssets, reindexSearch } from './db-schema'

/**
 * Rebuilding the derived tables.
 *
 * Everything named `_idx` is derived from the document tables and can be
 * rebuilt offline, from local data, in seconds. That is what makes it safe to
 * change how an index is computed: bump its version here, and the next login
 * rebuilds it. Nothing resyncs, and no document is touched.
 *
 * The alternative -- bumping `SCHEMA_VERSION` -- drops the documents too, and
 * `tx_chain` only comes back from the network. An index change should never
 * cost a resync.
 */

export interface EdgeDerivedTable {
  name: string

  /**
   * Bumped when the rebuild SQL below changes meaning.
   *
   * This is the whole mechanism: a stored version that does not match sends
   * the table through `rebuild` at open. Forgetting to bump it leaves every
   * existing device with rows computed the old way, which is invisible.
   */
  version: number

  /** Statements that discard the table's contents and recompute them. */
  rebuild: string[]
}

/**
 * Every derived table, and how to rebuild it.
 *
 * A table that is not listed here cannot be rebuilt, and would quietly stay
 * stale. Adding one to the schema means adding it here.
 */
export const derivedTables: EdgeDerivedTable[] = [
  { name: 'tx_asset_idx', version: 1, rebuild: reindexAssets() },
  // Rebuilding the text table rebuilds the FTS index with it, through the
  // same external-content triggers that maintain it in normal use.
  { name: 'tx_search_idx', version: 1, rebuild: reindexSearch() }
]

/**
 * Rebuilds every derived table whose stored version is out of date.
 *
 * Returns the names it rebuilt, which is worth logging: a rebuild at every
 * login means a version that is never being recorded.
 */
export async function reindexStale(driver: EdgeSqlDriver): Promise<string[]> {
  const rows = await driver.query<{ name: string; version: number }>(
    'SELECT name, version FROM index_version'
  )
  const stored = new Map(rows.map(row => [row.name, row.version]))

  const out: string[] = []
  for (const table of derivedTables) {
    if (stored.get(table.name) === table.version) continue
    await rebuildTable(driver, table)
    out.push(table.name)
  }
  return out
}

/** Rebuilds one derived table, whatever its recorded version says. */
export async function reindexTable(
  driver: EdgeSqlDriver,
  name: string
): Promise<void> {
  const table = derivedTables.find(table => table.name === name)
  if (table == null) throw new Error(`No derived table named ${name}`)
  await rebuildTable(driver, table)
}

async function rebuildTable(
  driver: EdgeSqlDriver,
  table: EdgeDerivedTable
): Promise<void> {
  // One transaction, so a rebuild interrupted half way leaves the old rows
  // rather than a partly-rebuilt table that nothing would know to finish.
  await driver.batch([
    ...table.rebuild.map(sql => ({ sql })),
    {
      sql: `INSERT INTO index_version (name, version) VALUES (?, ?)
              ON CONFLICT (name) DO UPDATE SET version = excluded.version`,
      params: [table.name, table.version]
    }
  ])
}

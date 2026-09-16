import { EdgeIo } from '../../types/types'

/**
 * The internal SQL seam.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * This lives outside `src/types/` on purpose. `EdgeIo` is handed to every
 * plugin through `EdgeCorePluginOptions.io`, and raw SQL there would let a
 * plugin read another wallet's rows, bypassing the wallet-scoped API the
 * plugins are meant to use.
 */

/** The value types that survive a round trip across the native bridge. */
export type EdgeSqlValue = string | number | boolean | null

export interface EdgeSqlStatement {
  sql: string
  params?: EdgeSqlValue[]
}

/** The fence one plugin's query runs under. */
export interface EdgeSqlScope {
  pluginId: string
  /** The plugin's table prefix, `p_<id>_`. */
  walletPrefix: string
  /** The wallet whose transactions the scoped view shows, if any. */
  walletId: string | null
}

/** Names every virtual table, for `connectStatement`. */
export const VIRTUAL_TABLES_SQL = `SELECT name FROM sqlite_schema
  WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`

/** A statement that connects one virtual table and reads nothing. */
export function connectStatement(name: string): string {
  return `SELECT 1 FROM "${name.replace(/"/g, '""')}" LIMIT 0`
}

export interface EdgeSqlDriver {
  /** Runs statements one at a time. Returns rows changed per statement. */
  exec: (statements: EdgeSqlStatement[]) => Promise<number[]>

  /** Runs one query, returning rows as objects. */
  query: <T>(sql: string, params?: EdgeSqlValue[]) => Promise<T[]>

  /**
   * Runs statements inside a single `BEGIN IMMEDIATE` ... `COMMIT`, rolling
   * the whole batch back on any failure. This is the primary write path: a
   * transaction spanning several driver calls would stay open across arbitrary
   * async JavaScript, and one thrown error would wedge the database.
   */
  batch: (statements: EdgeSqlStatement[]) => Promise<number[]>

  /**
   * Attaches another database by name, read-only, under a schema alias.
   *
   * By name rather than by path, because only the native side knows where
   * databases live -- which is also what keeps a caller from attaching an
   * arbitrary file.
   */
  attach: (name: string, alias: string) => Promise<void>

  /**
   * Runs one query fenced to a plugin and a wallet.
   *
   * One unit on this driver: nothing else runs between the fence going on
   * and coming off, so no other caller's statement is ever compiled under a
   * plugin's scope. Enforcement is native, at statement-compile time, so it
   * costs no bridge traffic per row.
   *
   * Every virtual table is connected first, in core mode. SQLite connects one
   * the first time a statement reaches it, and FTS5 does that by reading its
   * own shadow tables -- reads the fence cannot tell from the plugin's. A
   * plugin statement that was the first on a connection to fire a
   * search-index trigger would otherwise be refused.
   */
  queryScoped: <T>(
    scope: EdgeSqlScope,
    sql: string,
    params?: EdgeSqlValue[]
  ) => Promise<T[]>

  close: () => Promise<void>
}

/**
 * Runs work one item at a time, in the order it was handed over.
 *
 * Both drivers use this, for the same reason but against different hazards.
 * React Native dispatches native calls onto a thread pool, so two calls the
 * caller did not await could reach one connection in either order. Node's
 * addon is synchronous, so without this a caller could block the event loop
 * for the length of a large batch. Serializing in JavaScript gives both
 * platforms the same observable behaviour, which is the only way a test on
 * one says anything about the other.
 */
export function makeSerializer(): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()

  return async function serialize<T>(task: () => Promise<T>): Promise<T> {
    // The chain must not break on a rejection, or every later call inherits
    // the failure. Each link swallows its own result; the caller gets theirs
    // from the promise returned here.
    const out = chain.then(task, task)
    chain = out.then(
      () => undefined,
      () => undefined
    )
    return await out
  }
}

/**
 * `EdgeIo` widened with the SQL capability. Platforms that cannot open a
 * database leave these undefined, and the core keeps using its file-based
 * storage.
 */
export interface EdgeInternalIo extends EdgeIo {
  /**
   * `key` is the 32-byte database key. It is a construction parameter rather
   * than a field on the driver, so nothing downstream of this call -- which
   * is everything in `src/core/db/` -- ever holds it.
   */
  makeSqlDriver?: (name: string, key: Uint8Array) => Promise<EdgeSqlDriver>
  deleteSqlDatabase?: (name: string) => Promise<void>
}

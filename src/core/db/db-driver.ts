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

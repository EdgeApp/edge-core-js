import { EdgePluginStore, EdgeTableSpec } from '../../types/types'
import { EdgeInternalIo, EdgeSqlDriver } from './db-driver'
import { PLUGIN_DATABASE_NAME } from './db-open'
import { ensureOwnerPrefix } from './plugin-tables'
import { makeTableStore } from './tx-database-api'

/**
 * Storage for what belongs to a plugin rather than to any wallet.
 *
 * Fee estimates and server lists are fetched before any login, are the same
 * for every account on the device, and have to survive logout, so they cannot
 * live in an account's database. This is a second device-wide file beside the
 * rate cache, and in the rate cache's shape: one per device, not encrypted.
 *
 * **What that exposes**, stated as plainly as the rate cache states its own:
 * the file names the chains this device has plugins for and the servers they
 * talk to. It holds no key, no address, no balance and no transaction -- those
 * stay in the account's database, which is encrypted.
 *
 * It opens lazily. Nothing touches the file until a plugin calls into its
 * store, so a context still gets made on a platform with no SQL binding, and
 * the plugin that needs the file is the one that hears about it.
 */

/** Every plugin's own table registry. */
const schema = [
  `CREATE TABLE IF NOT EXISTS plugin (
    plugin_id     TEXT NOT NULL PRIMARY KEY,
    prefix        TEXT NOT NULL UNIQUE,
    table_version INTEGER
  )`
]

export interface PluginDatabase {
  /** The open driver, opening the file on the first call. */
  driver: () => Promise<EdgeSqlDriver>
  close: () => Promise<void>
}

/** One per context, shared by every plugin in it. */
export function makePluginDatabase(io: EdgeInternalIo): PluginDatabase {
  let opening: Promise<EdgeSqlDriver> | undefined
  let closed = false

  async function openOnce(): Promise<EdgeSqlDriver> {
    const { makeSqlDriver } = io
    if (makeSqlDriver == null) {
      throw new Error('Cannot open the plugin database: no SQL driver')
    }
    const driver = await makeSqlDriver(PLUGIN_DATABASE_NAME, new Uint8Array(0))
    try {
      await driver.exec(schema.map(sql => ({ sql })))
      return driver
    } catch (error: unknown) {
      await driver.close().catch(() => undefined)
      throw error
    }
  }

  /**
   * A file that will not open is deleted and opened again, once. It holds
   * nothing that is not refetched within minutes, so nothing in it is worth
   * a failure that would stop every engine that reads it.
   */
  async function open(): Promise<EdgeSqlDriver> {
    try {
      return await openOnce()
    } catch (firstError: unknown) {
      try {
        const { deleteSqlDatabase } = io
        if (deleteSqlDatabase == null) throw firstError
        await deleteSqlDatabase(PLUGIN_DATABASE_NAME)
        return await openOnce()
      } catch (error: unknown) {
        throw new Error(`Cannot open the plugin database: ${String(error)}`)
      }
    }
  }

  return {
    async driver() {
      if (closed) throw new Error('The plugin database is closed')
      if (opening == null) {
        const next = open()
        opening = next
        // A failed open is tried again on the next call, rather than
        // remembered, so a passing disk error does not last the session:
        next.catch(() => {
          if (opening === next) opening = undefined
        })
      }
      return await opening
    },

    async close() {
      closed = true
      const pending = opening
      opening = undefined
      if (pending == null) return
      const driver = await pending.catch(() => undefined)
      await driver?.close().catch(() => undefined)
    }
  }
}

/**
 * One plugin's store in the plugins database.
 *
 * Every method waits for the file and for the plugin's table prefix, both of
 * which happen at most once. The tables the plugin declares are attached to
 * the store it holds, so `${store.fee}` works in `runSql` as it does on a
 * wallet's handle.
 */
export function makePluginStore(
  database: PluginDatabase,
  pluginId: string
): EdgePluginStore {
  let inner: Promise<EdgePluginStore> | undefined

  const out: EdgePluginStore = {
    async defineTables(spec: EdgeTableSpec) {
      await (await store()).defineTables(spec)
    },
    async getRows(requests) {
      return await (await store()).getRows(requests)
    },
    async putRows(writes) {
      await (await store()).putRows(writes)
    },
    async putRowsIfAbsent(writes) {
      await (await store()).putRowsIfAbsent(writes)
    },
    async removeRows(removals) {
      await (await store()).removeRows(removals)
    },
    async findRows(table, query) {
      return await (await store()).findRows(table, query)
    },
    async batchWrite(ops) {
      await (await store()).batchWrite(ops)
    },
    async runSql(strings, ...values) {
      return await (await store()).runSql(strings, ...values)
    }
  }

  async function store(): Promise<EdgePluginStore> {
    // Every call goes by the database first, so one that arrives after the
    // context closed is refused even when it would not touch the file:
    await database.driver()
    if (inner == null) {
      const next = (async () => {
        const driver = await database.driver()
        const prefix = await ensureOwnerPrefix(
          driver,
          'plugin',
          pluginId,
          pluginId
        )
        return makeTableStore(
          {
            driver,
            owner: 'plugin',
            ownerId: pluginId,
            pluginId,
            prefix,
            fenceWalletId: null
          },
          (table, handle) => {
            out[table] = handle
          }
        )
      })()
      inner = next
      next.catch(() => {
        if (inner === next) inner = undefined
      })
    }
    return await inner
  }

  return out
}

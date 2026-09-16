import {
  EdgeBatchWrite,
  EdgeTableKeys,
  EdgeTableQuery,
  EdgeTableRows,
  EdgeTableSpec,
  EdgeTx,
  EdgeTxDatabase
} from '../../types/types'
import { batchWrite } from './batch-write'
import { EdgeSqlDriver, EdgeSqlValue } from './db-driver'
import { findRows, getRows, putRows, removeRows } from './plugin-rows'
import { tableName } from './plugin-tables'
import { saveTxs } from './tx-writer'

/**
 * The handle an engine is given: its own tables and its own transactions,
 * and nothing else.
 */

/**
 * A table, as a plugin refers to one.
 *
 * A plugin never writes a table name. It writes `${db.address}`, and the core
 * resolves that against the call's scope -- so a plugin cannot spell another
 * wallet's table because it never spells any table.
 */
export class EdgeTableHandle {
  readonly sql: string

  constructor(sql: string) {
    this.sql = sql
  }

  toString(): string {
    return this.sql
  }
}

export interface TxDatabaseOptions {
  driver: EdgeSqlDriver
  walletId: string
  pluginId: string
  prefix: string
  spec: EdgeTableSpec
}

export function makeTxDatabase(opts: TxDatabaseOptions): EdgeTxDatabase {
  const { driver, walletId, pluginId, prefix, spec } = opts
  const context = { driver, walletId, prefix, spec }

  const handles: { [table: string]: EdgeTableHandle } = {
    // The scoped view, not the base table: this is the only door a plugin has
    // onto the core's transactions.
    tx_chain: new EdgeTableHandle('tx_chain_scoped')
  }
  for (const table of Object.keys(spec.tables)) {
    handles[table] = new EdgeTableHandle(tableName(prefix, table))
  }

  const out: EdgeTxDatabase = {
    ...handles,

    async saveTxs(txs: EdgeTx[]): Promise<void> {
      // Identity comes from the handle, never from the object:
      await saveTxs(
        driver,
        txs.map(tx => ({ ...tx, walletId }))
      )
    },

    async getRows(requests: EdgeTableKeys[]): Promise<EdgeTableRows[]> {
      return await getRows(driver, prefix, spec, requests)
    },

    async putRows(writes: EdgeTableRows[]): Promise<void> {
      await putRows(driver, prefix, spec, writes)
    },

    async removeRows(removals: EdgeTableKeys[]): Promise<void> {
      await removeRows(driver, prefix, spec, removals)
    },

    async findRows(table: string, query: EdgeTableQuery): Promise<unknown[]> {
      return await findRows(driver, prefix, spec, table, query)
    },

    async batchWrite(ops: EdgeBatchWrite): Promise<void> {
      await batchWrite(context, ops)
    },

    async runSql<T>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> {
      let sql = ''
      const params: EdgeSqlValue[] = []
      strings.forEach((part, i) => {
        sql += part
        if (i >= values.length) return
        const value = values[i]
        // A table handle is spliced in as a name; everything else is bound,
        // so a plugin cannot build SQL out of a value it controls.
        if (value instanceof EdgeTableHandle) sql += value.sql
        else {
          sql += '?'
          params.push(value as EdgeSqlValue)
        }
      })

      /*
       * The fence goes on for this call and comes off after it.
       *
       * Only this one. Every other method composes its own SQL from validated
       * inputs and never interpolates plugin text, so scoping them would mean
       * paying two extra native calls to have the authorizer check statements
       * the core wrote itself.
       */
      return await driver.queryScoped<T>(
        { pluginId, walletPrefix: prefix, walletId },
        sql,
        params
      )
    }
  }

  return out
}

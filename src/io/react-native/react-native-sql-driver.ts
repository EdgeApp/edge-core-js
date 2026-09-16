import { base64 } from 'rfc4648'

import {
  EdgeSqlDriver,
  EdgeSqlStatement,
  EdgeSqlValue,
  makeSerializer
} from '../../core/db/db-driver'
import { NativeBridge } from './native-bridge'

/**
 * The React Native implementation of the SQL seam.
 *
 * The native side does the real work (`android/src/main/cpp/edge-sql.c`),
 * including the codec setup, so this file only marshals. Statements and rows
 * cross as JSON text because that is what the bridge already carries well, and
 * because it keeps the native surface a handful of methods wide rather than a
 * value protocol that iOS and Android could implement differently.
 */

/** `EdgeSqlValue` already matches what JSON carries, minus `undefined`. */
function toJsonParams(params: EdgeSqlValue[] | undefined): string | undefined {
  if (params == null || params.length === 0) return undefined
  return JSON.stringify(params)
}

function toJsonStatements(statements: EdgeSqlStatement[]): string {
  return JSON.stringify(
    statements.map(({ sql, params }) => ({ sql, params: params ?? [] }))
  )
}

export function makeReactNativeSqlDriver(
  nativeBridge: NativeBridge,
  handle: number
): EdgeSqlDriver {
  const serialize = makeSerializer()
  let closed = false

  function assertOpen(): void {
    if (closed) throw new Error('This database is closed')
  }

  return {
    async exec(statements) {
      assertOpen()
      return await serialize(async () =>
        JSON.parse(
          await nativeBridge.call(
            'sqlExec',
            handle,
            toJsonStatements(statements)
          )
        )
      )
    },

    async query<T>(sql: string, params?: EdgeSqlValue[]): Promise<T[]> {
      assertOpen()
      return await serialize(async () =>
        JSON.parse(
          await nativeBridge.call('sqlQuery', handle, sql, toJsonParams(params))
        )
      )
    },

    async batch(statements) {
      assertOpen()
      return await serialize(async () =>
        JSON.parse(
          await nativeBridge.call(
            'sqlBatch',
            handle,
            toJsonStatements(statements)
          )
        )
      )
    },

    async attach(name, alias) {
      assertOpen()
      await serialize(
        async () => await nativeBridge.call('sqlAttach', handle, name, alias)
      )
    },

    async setScope(pluginId, walletPrefix, walletId) {
      assertOpen()
      await serialize(
        async () =>
          await nativeBridge.call(
            'sqlSetScope',
            handle,
            pluginId,
            walletPrefix,
            walletId
          )
      )
    },

    async close() {
      if (closed) return
      closed = true
      await serialize(async () => await nativeBridge.call('sqlClose', handle))
    }
  }
}

export function makeReactNativeSqlDriverFactory(nativeBridge: NativeBridge): {
  makeSqlDriver: (name: string, key: Uint8Array) => Promise<EdgeSqlDriver>
  deleteSqlDatabase: (name: string) => Promise<void>
} {
  return {
    async makeSqlDriver(name, key) {
      const handle = await nativeBridge.call(
        'sqlOpen',
        name,
        base64.stringify(key)
      )
      return makeReactNativeSqlDriver(nativeBridge, handle)
    },

    async deleteSqlDatabase(name) {
      await nativeBridge.call('sqlDelete', name)
    }
  }
}

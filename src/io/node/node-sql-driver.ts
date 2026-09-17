import { mkdirSync } from 'fs'
import { dirname, join } from 'path'

import {
  connectStatement,
  EdgeSqlDriver,
  EdgeSqlScope,
  EdgeSqlStatement,
  EdgeSqlValue,
  makeSerializer,
  VIRTUAL_TABLES_SQL
} from '../../core/db/db-driver'
import { RATE_DATABASE_NAME } from '../../core/db/rate-cache'

/**
 * The Node implementation of the SQL seam.
 *
 * Node runs the *same* `edge-sql.c` and the same vendored SQLite amalgamation
 * as iOS and Android, through a small N-API addon. A published binding would
 * have meant a second SQLite that can drift from the vendored one, on the
 * platform where every test runs -- so a test passing here would say less
 * about the device than it appears to.
 *
 * The addon is synchronous, so the driver serializes calls onto a promise
 * chain. That gives Node the same ordering and interleaving the genuinely
 * asynchronous native bridge has, and keeps a large batch from blocking the
 * event loop for its whole duration.
 */

/** The addon's surface. Paths, not names -- this file resolves those. */
interface EdgeSqlAddon {
  open: (path: string, key: Buffer) => number
  exec: (handle: number, statementsJson: string) => string
  batch: (handle: number, statementsJson: string) => string
  query: (handle: number, sql: string, paramsJson: string | null) => string
  attach: (handle: number, path: string, alias: string) => void
  setScope: (
    handle: number,
    pluginId: string | null,
    walletPrefix: string | null,
    walletId: string | null
  ) => void
  close: (handle: number) => void
  remove: (path: string) => void
}

let addon: EdgeSqlAddon | null | undefined

/**
 * Where the addon sits, relative to this file, best first.
 *
 * `prebuilds/<platform>-<arch>/` is what a published tarball carries, and it
 * is named that way so one tarball can hold several and each consumer loads
 * only its own -- a foreign binary would `require` and throw, which the catch
 * below turns into a silently missing capability rather than an error anyone
 * sees. `build/Release/` is where `node-gyp` leaves a local build, which
 * wins nothing but must still work for a consumer that built it itself.
 *
 * Two depths for each because this file is read from two: `src/io/node` when
 * a test runs it through sucrase, and `lib/node` once rollup has bundled it.
 * A single relative path works in one and silently resolves outside the
 * package in the other -- which is how a consumer, not a test, found this.
 */
const PLATFORM = `${process.platform}-${process.arch}`
const ADDON_PATHS = [
  `../../../prebuilds/${PLATFORM}/edge_sql.node`,
  `../../prebuilds/${PLATFORM}/edge_sql.node`,
  '../../../build/Release/edge_sql.node',
  '../../build/Release/edge_sql.node'
]

/**
 * Loads the addon, once.
 *
 * Lazy and forgiving on purpose: React Native consumers never execute this
 * path, so a machine that cannot build the addon should lose the SQL
 * capability rather than fail to install.
 */
function loadAddon(): EdgeSqlAddon | undefined {
  if (addon === undefined) {
    addon = null
    for (const path of ADDON_PATHS) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        addon = require(path)
        break
      } catch (error) {
        // Try the next depth.
      }
    }
  }
  return addon ?? undefined
}

function toJsonParams(params: EdgeSqlValue[] | undefined): string | null {
  if (params == null || params.length === 0) return null
  return JSON.stringify(params)
}

function toJsonStatements(statements: EdgeSqlStatement[]): string {
  return JSON.stringify(
    statements.map(({ sql, params }) => ({ sql, params: params ?? [] }))
  )
}

export function makeNodeSqlDriver(
  sql: EdgeSqlAddon,
  handle: number,
  opts: {
    /** Instead of closing the handle, for databases that outlive a driver. */
    onClose?: () => void
    /** Resolves a database name to a file. Absent for in-memory databases. */
    filePath?: (name: string) => string
  } = {}
): EdgeSqlDriver {
  const { onClose = () => sql.close(handle), filePath } = opts
  const serialize = makeSerializer()
  let closed = false

  function assertOpen(): void {
    if (closed) throw new Error('This database is closed')
  }

  return {
    async exec(statements) {
      return await serialize(async () => {
        assertOpen()
        return JSON.parse(sql.exec(handle, toJsonStatements(statements)))
      })
    },

    async query<T>(sqlText: string, params?: EdgeSqlValue[]): Promise<T[]> {
      return await serialize(async () => {
        assertOpen()
        return JSON.parse(sql.query(handle, sqlText, toJsonParams(params)))
      })
    },

    async batch(statements) {
      return await serialize(async () => {
        assertOpen()
        return JSON.parse(sql.batch(handle, toJsonStatements(statements)))
      })
    },

    async attach(name, alias) {
      if (filePath == null) {
        // An in-memory database has no siblings to attach: there is no file
        // for a name to resolve to.
        throw new Error('This database cannot attach another')
      }
      await serialize(async () => {
        assertOpen()
        sql.attach(handle, filePath(name), alias)
      })
    },

    async queryScoped<T>(
      scope: EdgeSqlScope,
      sqlText: string,
      params?: EdgeSqlValue[]
    ): Promise<T[]> {
      return await serialize(async () => {
        assertOpen()
        const run = (text: string, values?: EdgeSqlValue[]): any[] =>
          JSON.parse(sql.query(handle, text, toJsonParams(values)))

        for (const { name } of run(VIRTUAL_TABLES_SQL)) {
          run(connectStatement(name))
        }
        sql.setScope(handle, scope.pluginId, scope.walletPrefix, scope.walletId)
        try {
          return run(sqlText, params)
        } finally {
          sql.setScope(handle, null, null, null)
        }
      })
    },

    async close() {
      await serialize(async () => {
        if (closed) return
        closed = true
        onClose()
      })
    }
  }
}

/**
 * A synchronous in-memory handle, for tests that assert on SQL behaviour
 * directly -- schema triggers, index fan-out, sort keys.
 *
 * The addon is synchronous underneath; only the driver above it is not. Giving
 * those tests this seam keeps them readable and keeps the addon's import in
 * one place, while still exercising the real amalgamation.
 *
 * **Not encrypted, and it cannot be.** The codec rejects a key on an in-memory
 * database outright, because there is no file to encrypt. Nothing is lost --
 * an in-memory database has no at-rest exposure -- but it does mean the codec
 * is *not* exercised here. That has to happen against real files; do not let
 * its coverage drift back to memory-only.
 */
export function makeMemorySqlSync(): {
  exec: (sql: string) => void
  run: (sql: string, ...params: EdgeSqlValue[]) => void
  all: <T>(sql: string) => T[]
  close: () => void
} {
  const sql = loadAddon()
  if (sql == null) throw new Error('The edge_sql addon is not built')
  const handle = sql.open(':memory:', Buffer.alloc(0))

  return {
    exec(text) {
      sql.exec(handle, JSON.stringify([{ sql: text }]))
    },
    run(text, ...params) {
      sql.exec(handle, JSON.stringify([{ sql: text, params }]))
    },
    all<T>(text: string): T[] {
      return JSON.parse(sql.query(handle, text, null))
    },
    close() {
      sql.close(handle)
    }
  }
}

/** An in-memory driver, for tests that want the asynchronous surface. */
export function makeMemorySqlDriver(): EdgeSqlDriver {
  const sql = loadAddon()
  if (sql == null) throw new Error('The edge_sql addon is not built')
  return makeNodeSqlDriver(sql, sql.open(':memory:', Buffer.alloc(0)))
}

/**
 * Mirrors the optional shape the widened io uses, so a factory can simply be
 * spread into an io: when the addon is missing both members are absent and the
 * capability reads as unavailable.
 */
interface SqlDriverFactory {
  makeSqlDriver?: (name: string, key: Uint8Array) => Promise<EdgeSqlDriver>
  deleteSqlDatabase?: (name: string) => Promise<void>
}

/**
 * Opens databases as files under `path`, creating the directory if needed.
 * `name` is a bare file name, not a path.
 */
export function makeNodeSqlDriverFactory(path: string): SqlDriverFactory {
  const sql = loadAddon()
  if (sql == null) return {}

  const filePath = (name: string): string =>
    join(path, 'databases', `${name}.db`)

  return {
    async makeSqlDriver(name, key) {
      /*
       * A file with no key would be a plaintext account database, which is the
       * one mistake the codec cannot catch for us.
       *
       * The rate cache is the single exception, and it is named here rather
       * than left as a hole: it holds public market data, it is shared across
       * accounts on purpose, and encrypting it would need a device-scoped key
       * that two of the four platforms cannot keep.
       */
      if (key.length === 0 && name !== RATE_DATABASE_NAME) {
        throw new Error('Refusing to open a database file without a key')
      }
      const file = filePath(name)
      mkdirSync(dirname(file), { recursive: true })
      return makeNodeSqlDriver(sql, sql.open(file, Buffer.from(key)), {
        filePath
      })
    },

    async deleteSqlDatabase(name) {
      sql.remove(filePath(name))
    }
  }
}

/**
 * A driver factory backed by in-memory databases, for the fake world.
 *
 * Databases are keyed by name and outlive the drivers that open them, so a
 * logout and a second login see the same data, exactly as a file would. They
 * live only as long as the process.
 */
export function makeMemorySqlDriverFactory(): SqlDriverFactory {
  const sql = loadAddon()
  if (sql == null) return {}
  const handles = new Map<string, number>()

  return {
    // `key` is accepted and ignored: an in-memory database cannot take one.
    async makeSqlDriver(name) {
      let handle = handles.get(name)
      if (handle == null) {
        handle = sql.open(':memory:', Buffer.alloc(0))
        handles.set(name, handle)
      }
      // Closing the driver must not close the shared handle:
      return makeNodeSqlDriver(sql, handle, { onClose: () => {} })
    },

    async deleteSqlDatabase(name) {
      const handle = handles.get(name)
      if (handle == null) return
      handles.delete(name)
      sql.close(handle)
    }
  }
}

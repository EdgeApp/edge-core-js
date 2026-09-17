import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  makeMemorySqlDriver,
  makeMemorySqlSync
} from '../../../src/io/node/node-sql-driver'
import { expectRejection } from '../../expect-rejection'

/**
 * The Node driver, over the real amalgamation.
 *
 * Everything here runs the same `edge-sql.c` that iOS and Android compile, so
 * these are not simulations of the native layer -- they are the native layer,
 * reached through a different bridge.
 */
describe('node SQL driver', function () {
  it('runs statements and reads rows back', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([
      { sql: 'CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)' },
      { sql: 'INSERT INTO t VALUES (?, ?)', params: ['a', 1] },
      { sql: 'INSERT INTO t VALUES (?, ?)', params: ['b', 2] }
    ])

    expect(await db.query('SELECT * FROM t ORDER BY id')).deep.equals([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 }
    ])
    await db.close()
  })

  it('reports rows changed per statement', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([{ sql: 'CREATE TABLE t (id TEXT)' }])

    expect(
      await db.exec([
        { sql: "INSERT INTO t VALUES ('a'), ('b'), ('c')" },
        { sql: "DELETE FROM t WHERE id = 'a'" }
      ])
    ).deep.equals([3, 1])
    await db.close()
  })

  it('round-trips every value type the bridge carries', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([
      { sql: 'CREATE TABLE t (s TEXT, i INTEGER, f REAL, b INTEGER, n TEXT)' },
      {
        sql: 'INSERT INTO t VALUES (?, ?, ?, ?, ?)',
        params: ['text', 42, 1.5, true, null]
      }
    ])

    expect(await db.query('SELECT * FROM t')).deep.equals([
      { s: 'text', i: 42, f: 1.5, b: 1, n: null }
    ])
    await db.close()
  })

  it('escapes quotes and control characters in returned text', async function () {
    const db = makeMemorySqlDriver()
    // Quotes, backslashes, and a control character below 0x20 that has no
    // two-character escape and so has to come out as \u0007.
    const nasty = ['he said "hi"', 'and \\ left', 'plus a \u0007 bell'].join(
      '\n\t'
    )
    await db.exec([
      { sql: 'CREATE TABLE t (s TEXT)' },
      { sql: 'INSERT INTO t VALUES (?)', params: [nasty] }
    ])

    // Rows cross the bridge as JSON text, escaped by hand in C because SQLite
    // has no JSON escape of its own. This is where a memo or an address label
    // would get corrupted.
    expect(await db.query('SELECT s FROM t')).deep.equals([{ s: nasty }])
    await db.close()
  })

  it('runs every statement in a multi-statement string', async function () {
    const db = makeMemorySqlDriver()
    // Schema blocks arrive this way. `sqlite3_prepare_v2` compiles only the
    // first statement and hands back the rest as a tail, so dropping the tail
    // would run part of the caller's SQL and report success.
    await db.exec([
      {
        sql: `
          CREATE TABLE a (id TEXT);
          CREATE TABLE b (id TEXT);
          CREATE TABLE c (id TEXT);
        `
      }
    ])

    expect(
      await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
    ).deep.equals([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    await db.close()
  })

  it('rolls a failed batch back whole', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([{ sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }])

    await expectRejection(
      db.batch([
        { sql: 'INSERT INTO t VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t VALUES (?)', params: ['b'] },
        // Duplicate key: the whole batch has to come back out.
        { sql: 'INSERT INTO t VALUES (?)', params: ['a'] }
      ])
    )

    expect(await db.query('SELECT * FROM t')).deep.equals([])
    await db.close()
  })

  it('leaves a failed exec partly applied', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([{ sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }])

    // The counterpart to the test above, and the reason `batch` exists: `exec`
    // commits statement by statement, so a caller that needs all-or-nothing
    // has to ask for it.
    await expectRejection(
      db.exec([
        { sql: 'INSERT INTO t VALUES (?)', params: ['a'] },
        { sql: 'INSERT INTO t VALUES (?)', params: ['a'] }
      ])
    )

    expect(await db.query('SELECT * FROM t')).deep.equals([{ id: 'a' }])
    await db.close()
  })

  it('keeps working after a statement fails', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([{ sql: 'CREATE TABLE t (id TEXT)' }])
    await expectRejection(db.query('SELECT * FROM nope'))

    // The serializing chain must not inherit the rejection, or one bad query
    // would wedge the connection for the rest of the session.
    expect(await db.query('SELECT * FROM t')).deep.equals([])
    await db.close()
  })

  it('runs calls in the order they were made', async function () {
    const db = makeMemorySqlDriver()
    await db.exec([{ sql: 'CREATE TABLE t (n INTEGER)' }])

    // Deliberately not awaited one at a time:
    const writes = []
    for (let i = 0; i < 20; ++i) {
      writes.push(db.exec([{ sql: 'INSERT INTO t VALUES (?)', params: [i] }]))
    }
    await Promise.all(writes)

    expect(await db.query<{ n: number }>('SELECT n FROM t')).deep.equals(
      [...Array(20).keys()].map(n => ({ n }))
    )
    await db.close()
  })

  it('refuses to work once closed', async function () {
    const db = makeMemorySqlDriver()
    await db.close()
    await expectRejection(db.query('SELECT 1'))
    // Closing twice is not an error; logout may race a wallet shutting down.
    await db.close()
  })

  it('reuses handles instead of growing without bound', async function () {
    // The handle table grows by doubling, and a version of it only ever
    // gained one *usable* slot per growth -- so capacity doubled on every
    // open past the eighth, and the process aborted trying to reallocate
    // gigabytes. Sixty opens is far past where that started.
    for (let i = 0; i < 60; ++i) {
      const db = makeMemorySqlDriver()
      await db.exec([{ sql: 'CREATE TABLE t (id TEXT)' }])
      await db.close()
    }

    // Still working afterwards, which a corrupted slot table would not be:
    const db = makeMemorySqlDriver()
    expect(await db.query('SELECT 1 AS n')).deep.equals([{ n: 1 }])
    await db.close()
  })

  it('exposes a synchronous handle for SQL-level tests', function () {
    const db = makeMemorySqlSync()
    db.exec('CREATE TABLE t (id TEXT)')
    db.run('INSERT INTO t VALUES (?)', 'a')
    expect(db.all('SELECT * FROM t')).deep.equals([{ id: 'a' }])
    db.close()
  })
})

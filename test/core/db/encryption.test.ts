import { expect } from 'chai'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { describe, it } from 'mocha'
import { tmpdir } from 'os'
import { join } from 'path'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { makeNodeSqlDriverFactory } from '../../../src/io/node/node-sql-driver'
import { expectRejection } from '../../expect-rejection'

/** Reached directly, to build the unencrypted control database below. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const addon = require('../../../build/Release/edge_sql.node')

/**
 * The database file is encrypted at rest.
 *
 * The failure this guards against is specific and silent: SQLite ignores an
 * unknown PRAGMA, so a build that lost the codec would accept `PRAGMA key`,
 * return a working handle, and write a plaintext database with no error
 * anywhere. `edge-sql.c` reads `PRAGMA cipher` back for that reason, and these
 * tests check the outcome from outside -- over the actual bytes on disk.
 *
 * A scan for a secret that can never match looks exactly like a scan that
 * passes, so every test here has something on the other side of it: the
 * unencrypted control database, or a key that is wrong rather than absent.
 */

const KEY = new Uint8Array(32).fill(0x2b)
const WRONG_KEY = new Uint8Array(32).fill(0x2c)

/** A value that must never be legible in the file. Not a real key. */
const SECRET = 'L1aW4aubDFB7yfras2S1mN3bqg9nZcVJhQ1nEXampeWifKey99xy'

/** The first 16 bytes of every unencrypted SQLite database. */
const SQLITE_HEADER = 'SQLite format 3\u0000'

interface TestDatabase {
  driver: EdgeSqlDriver
  /** The folder the factory was pointed at, for reopening. */
  path: string
  file: string
  /** Every byte the database wrote, across the main file and its siblings. */
  readBytes: () => string
  cleanup: () => void
}

function readAll(file: string): string {
  let out = ''
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      out += readFileSync(`${file}${suffix}`, 'latin1')
    } catch (error) {
      // A -wal or -shm sibling may not exist, which is fine.
    }
  }
  return out
}

let counter = 0
function makeTempPath(name: string): string {
  return join(tmpdir(), `edge-core-db-${name}-${process.pid}-${counter++}`)
}

async function makeFileDatabase(
  name: string,
  key: Uint8Array = KEY
): Promise<TestDatabase> {
  const path = makeTempPath(name)
  const { makeSqlDriver } = makeNodeSqlDriverFactory(path)
  if (makeSqlDriver == null) {
    throw new Error('No SQL driver: the addon is not built')
  }
  const driver = await makeSqlDriver(name, key)

  const file = join(path, 'databases', `${name}.db`)
  return {
    driver,
    path,
    file,
    readBytes: () => readAll(file),
    cleanup: () => rmSync(path, { force: true, recursive: true })
  }
}

async function writeSecret(driver: EdgeSqlDriver): Promise<void> {
  await driver.batch([
    { sql: 'CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, note TEXT)' },
    { sql: 'INSERT INTO t VALUES (?, ?)', params: ['row', SECRET] }
  ])
  // Force the WAL out to disk so the scan sees everything:
  await driver.exec([{ sql: 'PRAGMA wal_checkpoint(TRUNCATE)' }])
}

describe('the database is encrypted at rest', function () {
  it('does not write a plaintext SQLite header', async function () {
    const db = await makeFileDatabase('header')
    try {
      await writeSecret(db.driver)
      expect(
        readFileSync(db.file, 'latin1').slice(0, 16),
        'this file is an unencrypted SQLite database'
      ).does.not.equal(SQLITE_HEADER)
    } finally {
      await db.driver.close()
      db.cleanup()
    }
  })

  it('does not leave written values legible on disk', async function () {
    const db = await makeFileDatabase('scan')
    try {
      await writeSecret(db.driver)
      expect(
        db.readBytes().includes(SECRET),
        'the secret is readable in the database file'
      ).equals(false)
    } finally {
      await db.driver.close()
      db.cleanup()
    }
  })

  it('finds the same value when the codec is absent', async function () {
    // The negative control. Without it, a scan that can never match would look
    // exactly like a pass -- so this asserts the scan above can see a secret
    // when there is one to see.
    const path = makeTempPath('control')
    const file = join(path, 'control.db')

    // Opened with no key at all, which is what a build without the codec
    // would effectively produce.
    mkdirSync(path, { recursive: true })
    const handle = addon.open(file, Buffer.alloc(0))
    addon.exec(
      handle,
      JSON.stringify([
        { sql: 'CREATE TABLE t (id TEXT, note TEXT)' },
        { sql: 'INSERT INTO t VALUES (?, ?)', params: ['row', SECRET] }
      ])
    )
    addon.close(handle)

    try {
      expect(readFileSync(file, 'latin1').slice(0, 16)).equals(SQLITE_HEADER)
      expect(readAll(file).includes(SECRET)).equals(true)
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('survives a close and reopen with the same key', async function () {
    const db = await makeFileDatabase('reopen')
    try {
      await writeSecret(db.driver)
      await db.driver.close()

      const { makeSqlDriver } = makeNodeSqlDriverFactory(db.path)
      if (makeSqlDriver == null) throw new Error('No SQL driver')
      const again = await makeSqlDriver('reopen', KEY)
      expect(await again.query('SELECT note FROM t')).deep.equals([
        { note: SECRET }
      ])
      await again.close()
    } finally {
      db.cleanup()
    }
  })

  it('refuses the wrong key', async function () {
    const db = await makeFileDatabase('wrongkey')
    try {
      await writeSecret(db.driver)
      await db.driver.close()

      const { makeSqlDriver } = makeNodeSqlDriverFactory(db.path)
      if (makeSqlDriver == null) throw new Error('No SQL driver')

      // The codec cannot tell a wrong key from a corrupt file, so this may
      // fail at open or at the first read. Either is a rejection; what must
      // never happen is readable rows.
      await expectRejection(
        makeSqlDriver('wrongkey', WRONG_KEY).then(
          async driver => await driver.query('SELECT note FROM t')
        )
      )
    } finally {
      db.cleanup()
    }
  })

  it('refuses to open a file without a key', async function () {
    // The one mistake the codec cannot catch, because there is nothing to
    // check: a keyless open succeeds and writes plaintext.
    const path = makeTempPath('nokey')
    const { makeSqlDriver } = makeNodeSqlDriverFactory(path)
    if (makeSqlDriver == null) throw new Error('No SQL driver')
    try {
      await expectRejection(makeSqlDriver('nokey', new Uint8Array(0)))
    } finally {
      rmSync(path, { force: true, recursive: true })
    }
  })

  it('deletes the database and its WAL siblings', async function () {
    const db = await makeFileDatabase('remove')
    const { deleteSqlDatabase } = makeNodeSqlDriverFactory(db.path)
    if (deleteSqlDatabase == null) throw new Error('No SQL driver')
    try {
      await writeSecret(db.driver)
      await db.driver.exec([{ sql: 'PRAGMA wal_checkpoint(PASSIVE)' }])
      await db.driver.close()

      await deleteSqlDatabase('remove')
      for (const suffix of ['', '-wal', '-shm']) {
        expect(
          existsSync(`${db.file}${suffix}`),
          `${db.file}${suffix} is still there`
        ).equals(false)
      }
    } finally {
      db.cleanup()
    }
  })
})

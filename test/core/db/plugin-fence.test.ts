import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { ensureOwnerPrefix } from '../../../src/core/db/plugin-tables'
import {
  EdgeTableHandle,
  makeTxDatabase
} from '../../../src/core/db/tx-database-api'
import { saveTxs } from '../../../src/core/db/tx-writer'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTableSpec, EdgeTx, EdgeTxDatabase } from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'

/**
 * The plugin fence.
 *
 * `runSql` is the one place a plugin's own text reaches SQLite, so it is the
 * one place the authorizer has to hold. Everything here is the negative case:
 * what a plugin cannot do, checked by trying it.
 *
 * The policy is compiled into the native shim, which is why these tests run
 * against the real amalgamation rather than a simulation -- a fence that
 * worked in a mock and not on device would be worse than none.
 */

const WALLET_A = Buffer.alloc(32, 0x11).toString('base64')
const WALLET_B = Buffer.alloc(32, 0x22).toString('base64')

const spec: EdgeTableSpec = {
  version: 1,
  tables: { utxo: { key: ['id'], indexes: { byTxid: { paths: ['$.txid'] } } } }
}

function makeTx(walletId: string, txid: string): EdgeTx {
  return {
    walletId,
    txid,
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 800000,
    isSend: true,
    nativeAmounts: new Map([[null, '-100']]),
    networkFees: new Map([[null, '10']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map()
  }
}

interface Fixture {
  driver: EdgeSqlDriver
  a: EdgeTxDatabase
  b: EdgeTxDatabase
  prefixB: string
}

async function setup(): Promise<Fixture> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)

  const make = async (walletId: string): Promise<[EdgeTxDatabase, string]> => {
    const prefix = await ensureOwnerPrefix(
      driver,
      'wallet',
      walletId,
      'bitcoin'
    )
    const db = makeTxDatabase({
      driver,
      walletId,
      pluginId: 'bitcoin',
      prefix
    })
    // The real flow: an engine gets its handle, then declares its tables.
    await db.defineTables(spec)
    return [db, prefix]
  }

  const [a] = await make(WALLET_A)
  const [b, prefixB] = await make(WALLET_B)

  await saveTxs(driver, [makeTx(WALLET_A, 'mine'), makeTx(WALLET_B, 'theirs')])
  await a.putRows([{ table: 'utxo', rows: [{ id: 'ua', txid: 'mine' }] }])
  await b.putRows([{ table: 'utxo', rows: [{ id: 'ub', txid: 'theirs' }] }])

  return { driver, a, b, prefixB }
}

describe('plugin SQL fence', function () {
  it('reads its own tables', async function () {
    const { driver, a } = await setup()
    try {
      const rows = await a.runSql<{ doc: string }>`
        SELECT json(doc) AS doc FROM ${a.utxo}`
      expect(rows.length).equals(1)
      expect(JSON.parse(rows[0].doc).id).equals('ua')
    } finally {
      await driver.close()
    }
  })

  it('joins its tables to its own transactions', async function () {
    const { driver, a } = await setup()
    try {
      // The reason `runSql` exists: this is one round trip in place of the
      // per-output lookup loop the UTXO engine runs today.
      const rows = await a.runSql<{ txid: string }>`
        SELECT t.txid FROM ${a.tx_chain} t
          JOIN ${a.utxo} u ON u.doc ->> '$.txid' = t.txid
         WHERE t.block_height > ${1}`
      expect(rows.map(row => row.txid)).deep.equals(['mine'])
    } finally {
      await driver.close()
    }
  })

  it('sees only its own wallet through the scoped view', async function () {
    const { driver, a } = await setup()
    try {
      // Both transactions are in `tx_chain`; the view shows one. The wallet
      // never comes from the plugin's SQL, so there is nothing to get wrong.
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 2 }])

      const rows = await a.runSql<{ txid: string }>`
        SELECT txid FROM ${a.tx_chain}`
      expect(rows.map(row => row.txid)).deep.equals(['mine'])
    } finally {
      await driver.close()
    }
  })

  it('cannot name the base transaction table', async function () {
    const { driver, a } = await setup()
    try {
      await expectRejection(a.runSql`SELECT * FROM tx_chain`)
      await expectRejection(a.runSql`SELECT * FROM tx_meta`)
      await expectRejection(a.runSql`SELECT * FROM tx_asset_idx`)
      await expectRejection(a.runSql`SELECT * FROM wallet`)
    } finally {
      await driver.close()
    }
  })

  it('cannot reach another wallet tables', async function () {
    const { driver, a, b, prefixB } = await setup()
    try {
      // A real handle naming wallet B's table, which is the strongest form
      // of the attack: the authorizer compares the prefix against the scope
      // rather than trusting the handle it was given.
      const forged = new EdgeTableHandle(`${prefixB}utxo`)
      await expectRejection(a.runSql`SELECT * FROM ${forged}`)

      // ...and the same table is readable by the wallet that owns it, so the
      // denial above is about the scope and not about the name:
      expect(
        (await b.runSql<{ key: string }>`SELECT key FROM ${b.utxo}`).length
      ).equals(1)
    } finally {
      await driver.close()
    }
  })

  it('reads the token table but cannot write it', async function () {
    const { driver, a } = await setup()
    try {
      await driver.exec([
        {
          sql: `INSERT INTO token (plugin_id, token_id, currency_code, multiplier)
                VALUES ('bitcoin', '', 'BTC', '100000000')`
        }
      ])

      // Plugins need currency codes and denominations, so this one table is
      // readable -- and only readable. A plugin that could rewrite a
      // multiplier could change what every amount in the account appears to
      // be worth.
      expect(
        await a.runSql<{ currency_code: string }>`
          SELECT currency_code FROM token`
      ).deep.equals([{ currency_code: 'BTC' }])

      await expectRejection(a.runSql`UPDATE token SET multiplier = '1'`)
      await expectRejection(a.runSql`DELETE FROM token`)
    } finally {
      await driver.close()
    }
  })

  it('cannot see the account settings', async function () {
    const { driver, a } = await setup()
    try {
      // Which currency the user picked is the account's business, not a
      // plugin's -- and the deny here comes from the policy's default rather
      // than from a rule about this table, which is the property worth
      // holding onto as the schema grows.
      await expectRejection(a.runSql`SELECT value FROM setting`)
      await expectRejection(
        a.runSql`INSERT INTO setting (key, value) VALUES ('x', 'y')`
      )
    } finally {
      await driver.close()
    }
  })

  it('cannot discover what exists', async function () {
    const { driver, a } = await setup()
    try {
      // The catalog names every other table, so reading it would defeat the
      // point of not being able to name them.
      await expectRejection(a.runSql`SELECT name FROM sqlite_schema`)
      await expectRejection(a.runSql`SELECT name FROM sqlite_master`)
    } finally {
      await driver.close()
    }
  })

  it('cannot reach the codec', async function () {
    const { driver, a } = await setup()
    try {
      // Not a scoping slip -- a plugin that can rekey the file owns the
      // account's entire local cache.
      await expectRejection(a.runSql`PRAGMA key = "x'00'"`)
      await expectRejection(a.runSql`PRAGMA cipher`)
      await expectRejection(a.runSql`PRAGMA journal_mode`)
    } finally {
      await driver.close()
    }
  })

  it('cannot attach another file', async function () {
    const { driver, a } = await setup()
    try {
      await expectRejection(a.runSql`ATTACH DATABASE ':memory:' AS other`)
    } finally {
      await driver.close()
    }
  })

  it('cannot create schema that would launder access', async function () {
    const { driver, a } = await setup()
    try {
      // A view or trigger over a base table would read it on the plugin's
      // behalf, and `arg4` handling means the core trusts its own schema.
      await expectRejection(
        a.runSql`CREATE VIEW sneaky AS SELECT * FROM tx_chain`
      )
      await expectRejection(a.runSql`CREATE TABLE mine (a TEXT)`)
      await expectRejection(a.runSql`DROP TABLE tx_chain`)
    } finally {
      await driver.close()
    }
  })

  it('cannot open its own transaction', async function () {
    const { driver, a } = await setup()
    try {
      // A batch is already one transaction; an open one would span statements
      // the core did not compose.
      await expectRejection(a.runSql`BEGIN`)
      await expectRejection(a.runSql`SAVEPOINT s`)
    } finally {
      await driver.close()
    }
  })

  it('cannot read back the scope it is fenced by', async function () {
    const { driver, a } = await setup()
    try {
      // The view and its triggers call this on the plugin's behalf; the
      // plugin's own SQL may not.
      await expectRejection(a.runSql`SELECT edge_wallet()`)
    } finally {
      await driver.close()
    }
  })

  it('cannot reach what the search index reaches on its behalf', async function () {
    const { driver, a } = await setup()
    try {
      // Both are allowed only while a statement that passed the fence runs,
      // for the index's own use. Named by the plugin, they are refused.
      await expectRejection(a.runSql`PRAGMA data_version`)
      await expectRejection(a.runSql`SELECT * FROM tx_search_fts_idx_data`)
      await expectRejection(a.runSql`SELECT * FROM tx_search_fts_idx_config`)
    } finally {
      await driver.close()
    }
  })

  it('writes its own transactions through the view', async function () {
    const { driver, a } = await setup()
    try {
      await a.runSql`
        INSERT INTO ${a.tx_chain} (txid, doc)
        VALUES (${'fresh'}, jsonb(${JSON.stringify({
          walletId: 'ignored',
          txid: 'fresh',
          pluginId: 'bitcoin',
          date: '2024-06-02T00:00:00.000Z',
          blockHeight: 1,
          isSend: false,
          nativeAmounts: { '': '5' },
          networkFees: {},
          ourReceiveAddresses: [],
          memos: [],
          tokenData: {}
        })}))`

      // The trigger substituted the handle's wallet, whatever the document
      // said -- and the index followed inside the same statement.
      expect(
        await driver.query(
          `SELECT wallet_id FROM tx_chain WHERE txid = 'fresh'`
        )
      ).deep.equals([{ wallet_id: WALLET_A }])
      expect(
        await driver.query(
          `SELECT wallet_id FROM tx_asset_idx WHERE txid = 'fresh'`
        )
      ).deep.equals([{ wallet_id: WALLET_A }])
    } finally {
      await driver.close()
    }
  })

  it('cannot write another wallet transaction through the view', async function () {
    const { driver, a } = await setup()
    try {
      await a.runSql`
        UPDATE ${a.tx_chain} SET doc = jsonb('{"blockHeight":999}')
         WHERE txid = ${'theirs'}`

      // The view had no such row to update, so nothing happened -- rather
      // than the update reaching wallet B:
      const rows = await driver.query<{ block_height: number }>(
        `SELECT block_height FROM tx_chain WHERE txid = 'theirs'`
      )
      expect(rows[0].block_height).equals(800000)
    } finally {
      await driver.close()
    }
  })

  it('binds interpolated values rather than splicing them', async function () {
    const { driver, a } = await setup()
    try {
      // Everything that is not a table handle becomes a parameter, so a
      // plugin cannot build SQL out of a value it controls.
      const attack = "' OR 1=1 --"
      const rows = await a.runSql<{ txid: string }>`
        SELECT txid FROM ${a.tx_chain} WHERE txid = ${attack}`
      expect(rows).deep.equals([])
    } finally {
      await driver.close()
    }
  })

  it('leaves the core unfenced once the call is over', async function () {
    const { driver, a } = await setup()
    try {
      await expectRejection(a.runSql`SELECT * FROM tx_chain`)

      // The core has to be able to read its own tables afterwards, or one
      // failed plugin query would wedge the account:
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 2 }])
    } finally {
      await driver.close()
    }
  })

  it('keeps the driver own plumbing out of the fence', async function () {
    const { driver, a } = await setup()
    try {
      // The driver prepares its parameter binding against `json_each`, and
      // the authorizer cannot tell that apart from the caller's SQL. Passing
      // parameters at all is the test.
      const rows = await a.runSql<{ txid: string }>`
        SELECT txid FROM ${a.tx_chain} WHERE block_height > ${1}`
      expect(rows.map(row => row.txid)).deep.equals(['mine'])
    } finally {
      await driver.close()
    }
  })

  it('reaches the search index on a connection that has not yet', async function () {
    // A fresh connection, where nothing has touched the full-text index. The
    // delete fires its trigger, and connecting the index reads its shadow
    // tables -- which must not be the plugin's statement doing it.
    const driver = makeMemorySqlDriver()
    try {
      await prepareDatabase(driver)
      const prefix = await ensureOwnerPrefix(
        driver,
        'wallet',
        WALLET_A,
        'bitcoin'
      )
      const a = makeTxDatabase({
        driver,
        walletId: WALLET_A,
        pluginId: 'bitcoin',
        prefix
      })
      await a.runSql`DELETE FROM ${a.tx_chain}`
    } finally {
      await driver.close()
    }
  })

  it('runs nothing else inside the fence', async function () {
    const { driver, a } = await setup()
    try {
      // Started together, the core's batch lands in the queue between the
      // fence going on and the plugin's query -- unless the fence and the
      // query are one unit. A batch opens a transaction, which the fence
      // refuses.
      await Promise.all([
        a.runSql`SELECT count(*) AS n FROM ${a.utxo}`,
        driver.batch([{ sql: 'SELECT 1' }]),
        a.runSql`SELECT count(*) AS n FROM ${a.utxo}`,
        saveTxs(driver, [makeTx(WALLET_A, 'later')])
      ])
    } finally {
      await driver.close()
    }
  })
})

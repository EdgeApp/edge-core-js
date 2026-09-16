import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  defineTables,
  dropWalletTables,
  walletTablePrefix
} from '../../../src/core/db/plugin-tables'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTableSpec } from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'

/**
 * Plugin-owned tables.
 *
 * The wallet is in the table name rather than in a column, which is what
 * makes fencing a plugin a name check and deleting a wallet a `DROP TABLE`.
 * It also means a prefix collision would silently merge two wallets' storage,
 * so that is what most of these tests are about.
 */

/** Distinct wallet ids, which are base64 in the core. */
function walletId(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64')
}

const utxoSpec: EdgeTableSpec = {
  version: 1,
  tables: {
    address: {
      key: ['scriptPubkey'],
      indexes: {
        byPath: {
          paths: ['$.path.format', '$.path.changeIndex', '$.path.addressIndex'],
          unique: true
        },
        byUsed: { paths: ['$.path.format', '$.used'] }
      }
    },
    utxo: {
      key: ['id'],
      indexes: { spendable: { paths: ['$.spent', '$.scriptPubkey'] } }
    }
  }
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

async function tableNames(driver: EdgeSqlDriver): Promise<string[]> {
  const rows = await driver.query<{ name: string }>(
    `SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name LIKE 'p_%' ORDER BY name`
  )
  return rows.map(row => row.name)
}

describe('plugin table prefixes', function () {
  it('derives a prefix from the wallet id', function () {
    const prefix = walletTablePrefix(walletId(0x11))
    expect(prefix).matches(/^p_[1-9A-HJ-NP-Za-km-z]{8}_$/)
  })

  it('gives the same wallet the same prefix every time', function () {
    // Otherwise a second login would create a second set of tables and the
    // first set would become unreachable.
    expect(walletTablePrefix(walletId(0x11))).equals(
      walletTablePrefix(walletId(0x11))
    )
  })

  it('gives different wallets different prefixes', function () {
    expect(walletTablePrefix(walletId(0x11))).does.not.equal(
      walletTablePrefix(walletId(0x12))
    )
  })

  it('lengthens the prefix rather than sharing a table', function () {
    // Eight characters of base58 is 47 bits, so this never happens in
    // practice -- but the core knows every wallet id in the account, so
    // letting two wallets share a table would be a choice.
    const first = walletTablePrefix(walletId(0x11))
    const second = walletTablePrefix(walletId(0x11), [first])

    expect(second).does.not.equal(first)
    expect(second.length).greaterThan(first.length)
    expect(second.startsWith(first.slice(0, -1))).equals(true)
  })
})

describe('defineTables', function () {
  it('creates a table and its indexes per declared name', async function () {
    const driver = await makeDb()
    try {
      const { prefix } = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })

      expect(await tableNames(driver)).deep.equals([
        `${prefix}address`,
        `${prefix}utxo`
      ])

      const indexes = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_schema
          WHERE type = 'index' AND name LIKE 'p_%' ORDER BY name`
      )
      expect(indexes.map(row => row.name)).deep.equals([
        `${prefix}address_bypath_idx`,
        `${prefix}address_byused_idx`,
        `${prefix}utxo_spendable_idx`
      ])
    } finally {
      await driver.close()
    }
  })

  it('keeps two wallets of one plugin apart', async function () {
    const driver = await makeDb()
    try {
      const a = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })
      const b = await defineTables(driver, {
        walletId: walletId(0x12),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })

      // A shared prefix here would corrupt one wallet with another's rows,
      // and nothing downstream would notice.
      expect(a.prefix).does.not.equal(b.prefix)
      expect((await tableNames(driver)).length).equals(4)
    } finally {
      await driver.close()
    }
  })

  it('records what a prefix belongs to', async function () {
    const driver = await makeDb()
    try {
      const { prefix } = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })

      // The only place a table name maps back to a wallet, since there is no
      // wallet column to read it from.
      expect(
        await driver.query('SELECT wallet_id, prefix, plugin_id FROM wallet')
      ).deep.equals([
        { wallet_id: walletId(0x11), prefix, plugin_id: 'bitcoin' }
      ])
    } finally {
      await driver.close()
    }
  })

  it('does nothing the second time a wallet starts', async function () {
    const driver = await makeDb()
    try {
      const opts = {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      }
      const first = await defineTables(driver, opts)
      await driver.exec([
        {
          sql: `INSERT INTO "${first.prefix}utxo" (key, doc)
                VALUES ('u1', jsonb('{"id":"u1"}'))`
        }
      ])

      const second = await defineTables(driver, opts)
      expect(second.prefix).equals(first.prefix)
      expect(second.rebuilt).equals(false)
      expect(
        await driver.query(`SELECT count(*) AS n FROM "${first.prefix}utxo"`)
      ).deep.equals([{ n: 1 }])
    } finally {
      await driver.close()
    }
  })

  it('empties the tables when the declaration changes', async function () {
    const driver = await makeDb()
    try {
      const { prefix } = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })
      await driver.exec([
        {
          sql: `INSERT INTO "${prefix}utxo" (key, doc)
                VALUES ('u1', jsonb('{"id":"u1"}'))`
        }
      ])

      // The core cannot migrate a document shape it does not understand, and
      // the plugin can refill from the chain -- so the cache is dropped, and
      // the caller is told.
      const again = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: { ...utxoSpec, version: 2 }
      })
      expect(again.rebuilt).equals(true)
      expect(
        await driver.query(`SELECT count(*) AS n FROM "${prefix}utxo"`)
      ).deep.equals([{ n: 0 }])
    } finally {
      await driver.close()
    }
  })

  it('indexes the paths it was told to', async function () {
    const driver = await makeDb()
    try {
      const { prefix } = await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })

      // The point of declaring an index is that a query can use it:
      const plan = await driver.query<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT * FROM "${prefix}utxo"
          WHERE doc ->> '$.spent' = 0 AND doc ->> '$.scriptPubkey' = 'abc'`
      )
      expect(plan.map(row => row.detail).join(' ')).includes(
        `${prefix}utxo_spendable_idx`
      )
    } finally {
      await driver.close()
    }
  })

  it('refuses a name it would have to interpolate', async function () {
    const driver = await makeDb()
    try {
      // Table and index names cannot be bound as parameters, so they are
      // checked rather than escaped.
      for (const table of ['a"b', 'a;DROP TABLE wallet', '', 'a b']) {
        await expectRejection(
          defineTables(driver, {
            walletId: walletId(0x11),
            pluginId: 'bitcoin',
            spec: { version: 1, tables: { [table]: { key: ['id'] } } }
          })
        )
      }
      expect(await tableNames(driver)).deep.equals([])
    } finally {
      await driver.close()
    }
  })

  it('refuses an index path that is not a document path', async function () {
    const driver = await makeDb()
    try {
      await expectRejection(
        defineTables(driver, {
          walletId: walletId(0x11),
          pluginId: 'bitcoin',
          spec: {
            version: 1,
            tables: {
              utxo: {
                key: ['id'],
                indexes: { bad: { paths: ["'); DROP TABLE wallet; --"] } }
              }
            }
          }
        })
      )
    } finally {
      await driver.close()
    }
  })

  it('refuses a table with no key', async function () {
    const driver = await makeDb()
    try {
      await expectRejection(
        defineTables(driver, {
          walletId: walletId(0x11),
          pluginId: 'bitcoin',
          spec: { version: 1, tables: { utxo: { key: [] } } }
        })
      )
    } finally {
      await driver.close()
    }
  })

  it('drops a wallet as a DROP TABLE, not a DELETE', async function () {
    const driver = await makeDb()
    try {
      await defineTables(driver, {
        walletId: walletId(0x11),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })
      const other = await defineTables(driver, {
        walletId: walletId(0x12),
        pluginId: 'bitcoin',
        spec: utxoSpec
      })

      await dropWalletTables(driver, walletId(0x11))

      expect(await tableNames(driver)).deep.equals([
        `${other.prefix}address`,
        `${other.prefix}utxo`
      ])
      expect(await driver.query('SELECT wallet_id FROM wallet')).deep.equals([
        { wallet_id: walletId(0x12) }
      ])
    } finally {
      await driver.close()
    }
  })
})

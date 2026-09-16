import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import {
  findRows,
  getRows,
  putRows,
  removeRows
} from '../../../src/core/db/plugin-rows'
import { defineTables } from '../../../src/core/db/plugin-tables'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTableSpec } from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'

/**
 * The plugin row API.
 *
 * Shaped around the fact that every call is a bridge round trip, so an engine
 * wanting three addresses and two UTXOs pays for one crossing. That is why
 * everything takes an array of per-table requests, and why the answers are
 * aligned to the keys that asked for them.
 */

const spec: EdgeTableSpec = {
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
    },
    pair: { key: ['chain', 'height'] }
  }
}

interface Fixture {
  driver: EdgeSqlDriver
  prefix: string
}

async function setup(): Promise<Fixture> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  const { prefix } = await defineTables(driver, {
    walletId: Buffer.alloc(32, 0x11).toString('base64'),
    pluginId: 'bitcoin',
    spec
  })
  return { driver, prefix }
}

const address = (scriptPubkey: string, changeIndex = 0, used = false): any => ({
  scriptPubkey,
  used,
  path: { format: 'bip84', changeIndex, addressIndex: 0 }
})

describe('plugin rows', function () {
  it('round-trips a document unchanged', async function () {
    const { driver, prefix } = await setup()
    try {
      const row = address('abc')
      await putRows(driver, prefix, spec, [{ table: 'address', rows: [row] }])

      const [result] = await getRows(driver, prefix, spec, [
        { table: 'address', keys: ['abc'] }
      ])
      // The plugin's own shape comes back as it went in -- there is no
      // mapping layer to get wrong.
      expect(result.rows[0]).deep.equals(row)
    } finally {
      await driver.close()
    }
  })

  it('aligns answers to the keys that asked for them', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        { table: 'address', rows: [address('a', 0), address('c', 2)] }
      ])

      const [result] = await getRows(driver, prefix, spec, [
        { table: 'address', keys: ['a', 'b', 'c'] }
      ])

      // A caller zipping these against its own input has to be able to trust
      // the positions, and to learn *which* key was missing.
      expect(result.rows.length).equals(3)
      expect((result.rows[0] as any).scriptPubkey).equals('a')
      expect(result.rows[1]).equals(undefined)
      expect((result.rows[2] as any).scriptPubkey).equals('c')
    } finally {
      await driver.close()
    }
  })

  it('answers several tables in one call', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        { table: 'address', rows: [address('a')] },
        { table: 'utxo', rows: [{ id: 'u1', spent: false, scriptPubkey: 'a' }] }
      ])

      const results = await getRows(driver, prefix, spec, [
        { table: 'utxo', keys: ['u1'] },
        { table: 'address', keys: ['a'] }
      ])

      // In request order, not table order:
      expect(results.map(result => result.table)).deep.equals([
        'utxo',
        'address'
      ])
      expect((results[0].rows[0] as any).id).equals('u1')
    } finally {
      await driver.close()
    }
  })

  it('replaces a row rather than merging it', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        { table: 'address', rows: [{ ...address('a'), note: 'first' }] }
      ])
      await putRows(driver, prefix, spec, [
        { table: 'address', rows: [address('a')] }
      ])

      // A plugin owns its documents whole and has the previous one to hand.
      // `tx_chain` merges because one transaction arrives once per asset;
      // nothing here does.
      const [result] = await getRows(driver, prefix, spec, [
        { table: 'address', keys: ['a'] }
      ])
      expect((result.rows[0] as any).note).equals(undefined)
    } finally {
      await driver.close()
    }
  })

  it('takes the key from the document', async function () {
    const { driver, prefix } = await setup()
    try {
      // The caller never supplies a key for a write, so the key and the
      // document cannot disagree.
      await putRows(driver, prefix, spec, [
        { table: 'utxo', rows: [{ id: 'u1', spent: false }] }
      ])
      expect(await driver.query(`SELECT key FROM "${prefix}utxo"`)).deep.equals(
        [{ key: 'u1' }]
      )
    } finally {
      await driver.close()
    }
  })

  it('refuses a document with no key', async function () {
    const { driver, prefix } = await setup()
    try {
      await expectRejection(
        putRows(driver, prefix, spec, [
          { table: 'utxo', rows: [{ spent: false }] }
        ])
      )
    } finally {
      await driver.close()
    }
  })

  it('handles a composite key', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        {
          table: 'pair',
          rows: [
            { chain: 'btc', height: 1 },
            { chain: 'btc', height: 2 }
          ]
        }
      ])
      expect(
        await driver.query(`SELECT count(*) AS n FROM "${prefix}pair"`)
      ).deep.equals([{ n: 2 }])
    } finally {
      await driver.close()
    }
  })

  it('removes rows by key', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        { table: 'address', rows: [address('a'), address('b', 1)] }
      ])
      await removeRows(driver, prefix, spec, [
        { table: 'address', keys: ['a'] }
      ])

      const [result] = await getRows(driver, prefix, spec, [
        { table: 'address', keys: ['a', 'b'] }
      ])
      expect(result.rows[0]).equals(undefined)
      expect(result.rows[1]).does.not.equal(undefined)
    } finally {
      await driver.close()
    }
  })

  it('refuses a table it was never told about', async function () {
    const { driver, prefix } = await setup()
    try {
      // The alternative is a SQL error naming a table the plugin never
      // wrote, which says nothing about what it did wrong.
      await expectRejection(
        getRows(driver, prefix, spec, [{ table: 'nope', keys: ['a'] }])
      )
      await expectRejection(
        putRows(driver, prefix, spec, [{ table: 'nope', rows: [{}] }])
      )
    } finally {
      await driver.close()
    }
  })

  it('finds rows through a declared index', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        {
          table: 'utxo',
          rows: [
            { id: 'u1', spent: false, scriptPubkey: 'a' },
            { id: 'u2', spent: true, scriptPubkey: 'a' },
            { id: 'u3', spent: false, scriptPubkey: 'b' }
          ]
        }
      ])

      const found = await findRows(driver, prefix, spec, 'utxo', {
        equals: { '$.spent': false, '$.scriptPubkey': 'a' }
      })
      expect(found.map((row: any) => row.id)).deep.equals(['u1'])
    } finally {
      await driver.close()
    }
  })

  it('orders and limits, which is how a maximum is read', async function () {
    const { driver, prefix } = await setup()
    try {
      await putRows(driver, prefix, spec, [
        {
          table: 'address',
          rows: [address('a', 0, true), address('b', 3, true), address('c', 1)]
        }
      ])

      // This is what replaces the separate "last used index" table the UTXO
      // plugin keeps today: the index already orders them.
      const found = await findRows(driver, prefix, spec, 'address', {
        equals: { '$.path.format': 'bip84', '$.used': true },
        orderBy: [{ path: '$.path.changeIndex', direction: 'desc' }],
        limit: 1
      })
      expect((found[0] as any).scriptPubkey).equals('b')
    } finally {
      await driver.close()
    }
  })

  it('reads the whole table when asked for no predicate', async function () {
    const { driver, prefix } = await setup()
    try {
      // A scan is the only plan there is for "everything", so refusing it
      // would be refusing the question. Computing a spendable balance from
      // one wallet's UTXOs is exactly this query.
      await putRows(driver, prefix, spec, [
        { table: 'utxo', rows: [{ id: 'u1' }, { id: 'u2' }] }
      ])
      expect((await findRows(driver, prefix, spec, 'utxo', {})).length).equals(
        2
      )
    } finally {
      await driver.close()
    }
  })

  it('refuses a query no declared index can answer', async function () {
    const { driver, prefix } = await setup()
    try {
      // A plugin with 20,000 addresses finds this out during development
      // rather than in production.
      await expectRejection(
        findRows(driver, prefix, spec, 'address', {
          equals: { '$.somethingUnindexed': 1 }
        })
      )
    } finally {
      await driver.close()
    }
  })

  it('refuses a path that is not a document path', async function () {
    const { driver, prefix } = await setup()
    try {
      await expectRejection(
        findRows(driver, prefix, spec, 'address', {
          equals: { '1=1); DROP TABLE wallet; --': 1 }
        })
      )
      expect(
        await driver.query(
          `SELECT count(*) AS n FROM sqlite_schema WHERE name = 'wallet'`
        )
      ).deep.equals([{ n: 1 }])
    } finally {
      await driver.close()
    }
  })

  it('does nothing for an empty request', async function () {
    const { driver, prefix } = await setup()
    try {
      expect(
        await getRows(driver, prefix, spec, [{ table: 'utxo', keys: [] }])
      ).deep.equals([{ table: 'utxo', rows: [] }])
      await putRows(driver, prefix, spec, [])
      await removeRows(driver, prefix, spec, [{ table: 'utxo', keys: [] }])
    } finally {
      await driver.close()
    }
  })
})

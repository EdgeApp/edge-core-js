import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import {
  derivedTables,
  reindexStale,
  reindexTable
} from '../../../src/core/db/db-index'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { expectRejection } from '../../expect-rejection'

/**
 * The reindex driver.
 *
 * Its whole promise is that a derived table can be thrown away and rebuilt
 * from the documents, offline, and come back the same. If that is not true,
 * the cheap fix for an index bug -- bump a version, rebuild at next login --
 * silently produces different rows than the triggers do, and only the users
 * who reindexed would see it.
 */

/** The full contents of the asset index, ordered so two runs compare. */
async function snapshot(driver: EdgeSqlDriver): Promise<unknown[]> {
  return await driver.query(
    'SELECT * FROM tx_asset_idx ORDER BY wallet_id, txid, token_id'
  )
}

interface ChainDoc {
  date?: string
  nativeAmounts?: { [tokenKey: string]: string }
  networkFees?: { [tokenKey: string]: string }
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

async function putChain(
  driver: EdgeSqlDriver,
  walletId: string,
  txid: string,
  doc: ChainDoc
): Promise<void> {
  await driver.exec([
    {
      sql: `INSERT OR REPLACE INTO tx_chain (wallet_id, txid, doc)
            VALUES (?, ?, jsonb(?))`,
      params: [
        walletId,
        txid,
        JSON.stringify({
          walletId,
          txid,
          pluginId: 'bitcoin',
          date: '2024-06-01T12:00:00.000Z',
          blockHeight: 800000,
          isSend: true,
          nativeAmounts: {},
          networkFees: {},
          ...doc
        })
      ]
    }
  ])
}

async function putMeta(
  driver: EdgeSqlDriver,
  walletId: string,
  txid: string,
  doc: object
): Promise<void> {
  await driver.exec([
    {
      sql: `INSERT OR REPLACE INTO tx_meta (wallet_id, txid, doc)
            VALUES (?, ?, jsonb(?))`,
      params: [
        walletId,
        txid,
        JSON.stringify({ txid, creationDate: 1717200000, tokens: {}, ...doc })
      ]
    }
  ])
}

/**
 * A database holding every shape the triggers have to handle, so a rebuild
 * that only works for the simple case cannot pass.
 */
async function makePopulatedDb(): Promise<EdgeSqlDriver> {
  const driver = await makeDb()

  // Plain single-asset transaction:
  await putChain(driver, 'W1', 'tx1', { nativeAmounts: { '': '-100' } })

  // Token transfer: amount on one asset, fee on another:
  await putChain(driver, 'W1', 'tx2', {
    nativeAmounts: { abc: '50000000' },
    networkFees: { '': '2100' }
  })

  // Chain data and metadata together, metadata dated earlier:
  await putMeta(driver, 'W1', 'tx3', {
    creationDate: 1000,
    tokens: { '': { metadata: { name: 'Alice', notes: 'rent' } } }
  })
  await putChain(driver, 'W1', 'tx3', { nativeAmounts: { '': '-300' } })

  // An orphan: metadata for a transaction this device has not seen:
  await putMeta(driver, 'W1', 'tx4', {
    tokens: { '': { metadata: { category: 'Income:Salary' } } }
  })

  // A second wallet, sharing a txid with the first:
  await putChain(driver, 'W2', 'tx1', { nativeAmounts: { '': '-999' } })

  // One that was updated to touch fewer assets:
  await putChain(driver, 'W2', 'tx5', {
    nativeAmounts: { '': '-1', abc: '2' }
  })
  await putChain(driver, 'W2', 'tx5', { nativeAmounts: { '': '-1' } })

  // One whose chain row was later dropped, leaving the annotation:
  await putMeta(driver, 'W2', 'tx6', {
    tokens: { '': { metadata: { name: 'Bob' } } }
  })
  await putChain(driver, 'W2', 'tx6', { nativeAmounts: { '': '-6' } })
  await driver.exec([
    { sql: `DELETE FROM tx_chain WHERE wallet_id = 'W2' AND txid = 'tx6'` }
  ])

  return driver
}

describe('reindex driver', function () {
  it('rebuilds exactly what the triggers produced', async function () {
    const driver = await makePopulatedDb()
    try {
      const before = await snapshot(driver)
      expect(before.length, 'nothing to compare').greaterThan(6)

      await reindexTable(driver, 'tx_asset_idx')

      expect(await snapshot(driver)).deep.equals(before)
    } finally {
      await driver.close()
    }
  })

  it('repairs an index that has lost rows', async function () {
    const driver = await makePopulatedDb()
    try {
      const before = await snapshot(driver)
      await driver.exec([{ sql: 'DELETE FROM tx_asset_idx' }])
      expect(await snapshot(driver)).deep.equals([])

      await reindexTable(driver, 'tx_asset_idx')
      expect(await snapshot(driver)).deep.equals(before)
    } finally {
      await driver.close()
    }
  })

  it('repairs an index holding rows for a transaction that is gone', async function () {
    const driver = await makePopulatedDb()
    try {
      const before = await snapshot(driver)
      await driver.exec([
        {
          sql: `INSERT INTO tx_asset_idx
                  (wallet_id, txid, token_id, effective_date)
                VALUES ('W9', 'ghost', '', 1)`
        }
      ])

      await reindexTable(driver, 'tx_asset_idx')
      expect(await snapshot(driver)).deep.equals(before)
    } finally {
      await driver.close()
    }
  })

  it('rebuilds a table whose version has moved', async function () {
    const driver = await makePopulatedDb()
    try {
      // A database built from scratch is already current, so opening it does
      // not rebuild anything -- which is what every login should see:
      expect(await reindexStale(driver)).deep.equals([])

      // An older device, built by an earlier version of the rebuild SQL:
      await driver.exec([
        { sql: `UPDATE index_version SET version = 0` },
        { sql: `DELETE FROM tx_asset_idx` }
      ])
      expect(await reindexStale(driver)).deep.equals([
        'tx_asset_idx',
        'tx_search_idx'
      ])
      expect((await snapshot(driver)).length).greaterThan(6)
    } finally {
      await driver.close()
    }
  })

  it('rebuilds a table it has no version for', async function () {
    const driver = await makePopulatedDb()
    try {
      // A database from before this table existed. There is no version to
      // compare against, so the only safe reading is "out of date".
      await driver.exec([{ sql: 'DELETE FROM index_version' }])
      expect(await reindexStale(driver)).deep.equals([
        'tx_asset_idx',
        'tx_search_idx'
      ])
    } finally {
      await driver.close()
    }
  })

  it('refuses to rebuild a table it does not know', async function () {
    const driver = await makeDb()
    try {
      // The failure mode this catches is a derived table added to the schema
      // but not to `derivedTables`, which would never be rebuilt at all.
      await expectRejection(reindexTable(driver, 'tx_nonexistent_idx'))
    } finally {
      await driver.close()
    }
  })

  it('lists every derived table in the schema', function () {
    // A table named `_idx` that is not here cannot be rebuilt.
    expect(derivedTables.map(table => table.name)).deep.equals([
      'tx_asset_idx',
      'tx_search_idx'
    ])
  })
})

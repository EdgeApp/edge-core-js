import { expect } from 'chai'
import { describe, it } from 'mocha'

import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { asEdgeTx } from '../../../src/core/db/tx-cleaners'
import { replaceTxs, saveTxs } from '../../../src/core/db/tx-writer'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTx } from '../../../src/types/types'

/**
 * Writing transactions.
 *
 * The merge is the whole point. One transaction reaches the core once per
 * asset it touches, each report complete for that asset and silent about the
 * others -- so a write that replaced would leave whichever asset arrived last
 * as the only one the wallet ever had.
 */

function makeTx(overrides: Partial<EdgeTx> = {}): EdgeTx {
  return {
    walletId: 'W1',
    txid: 'tx1',
    pluginId: 'ethereum',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 0,
    isSend: true,
    nativeAmounts: new Map(),
    networkFees: new Map(),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map(),
    ...overrides
  }
}

async function makeDb(): Promise<EdgeSqlDriver> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  return driver
}

async function readTx(
  driver: EdgeSqlDriver,
  walletId = 'W1',
  txid = 'tx1'
): Promise<EdgeTx> {
  const rows = await driver.query<{ doc: string }>(
    `SELECT json(doc) AS doc FROM tx_chain
      WHERE wallet_id = ? AND txid = ?`,
    [walletId, txid]
  )
  return asEdgeTx(JSON.parse(rows[0].doc))
}

describe('transaction writer', function () {
  it('writes a transaction the schema can read', async function () {
    const driver = await makeDb()
    try {
      await saveTxs(driver, [
        makeTx({
          nativeAmounts: new Map([[null, '-100']]),
          networkFees: new Map([[null, '21000']])
        })
      ])

      expect(
        await driver.query(
          `SELECT token_id, has_chain, plugin_id, is_send
             FROM tx_asset_idx ORDER BY token_id`
        )
      ).deep.equals([
        { token_id: '', has_chain: 1, plugin_id: 'ethereum', is_send: 1 }
      ])
    } finally {
      await driver.close()
    }
  })

  it('merges the second asset beside the first', async function () {
    const driver = await makeDb()
    try {
      // A token transfer on an EVM chain arrives twice: once as the token
      // moving, once as the chain asset paying the fee.
      await saveTxs(driver, [
        makeTx({ nativeAmounts: new Map([['abc', '50000000']]) })
      ])
      await saveTxs(driver, [
        makeTx({
          nativeAmounts: new Map([[null, '0']]),
          networkFees: new Map([[null, '21000']])
        })
      ])

      const tx = await readTx(driver)
      expect(tx.nativeAmounts.get('abc')).equals('50000000')
      expect(tx.nativeAmounts.get(null)).equals('0')
      expect(tx.nativeAmounts.size).equals(2)
      expect([...tx.networkFees]).deep.equals([[null, '21000']])

      // And the index followed:
      expect(
        (
          await driver.query<{ token_id: string }>(
            'SELECT token_id FROM tx_asset_idx ORDER BY token_id'
          )
        ).map(row => row.token_id)
      ).deep.equals(['', 'abc'])
    } finally {
      await driver.close()
    }
  })

  it('lets a later report update the chain columns', async function () {
    const driver = await makeDb()
    try {
      await saveTxs(driver, [
        makeTx({ blockHeight: 0, nativeAmounts: new Map([[null, '-100']]) })
      ])
      // Confirmation is the commonest second write there is:
      await saveTxs(driver, [
        makeTx({ blockHeight: 800000, nativeAmounts: new Map() })
      ])

      expect((await readTx(driver)).blockHeight).equals(800000)
      expect(
        await driver.query('SELECT block_height FROM tx_asset_idx')
      ).deep.equals([{ block_height: 800000 }])

      // ...without losing the amount the first report carried:
      expect([...(await readTx(driver)).nativeAmounts]).deep.equals([
        [null, '-100']
      ])
    } finally {
      await driver.close()
    }
  })

  it('replaces arrays rather than merging them', async function () {
    const driver = await makeDb()
    try {
      // RFC 7386 replaces arrays wholesale, which is right here: these
      // describe the transaction, not one asset's view of it, so the latest
      // report is the complete one rather than a contribution.
      await saveTxs(driver, [
        makeTx({ ourReceiveAddresses: ['addr1', 'addr2'] })
      ])
      await saveTxs(driver, [makeTx({ ourReceiveAddresses: ['addr3'] })])

      expect((await readTx(driver)).ourReceiveAddresses).deep.equals(['addr3'])
    } finally {
      await driver.close()
    }
  })

  it('cannot drop an asset by merging', async function () {
    const driver = await makeDb()
    try {
      await saveTxs(driver, [
        makeTx({
          nativeAmounts: new Map([
            [null, '-100'],
            ['abc', '50']
          ])
        })
      ])
      await saveTxs(driver, [
        makeTx({ nativeAmounts: new Map([[null, '-100']]) })
      ])

      // The merge kept it, which is why `replaceTxs` exists:
      expect([...(await readTx(driver)).nativeAmounts].length).equals(2)

      await replaceTxs(driver, [
        makeTx({ nativeAmounts: new Map([[null, '-100']]) })
      ])
      expect([...(await readTx(driver)).nativeAmounts]).deep.equals([
        [null, '-100']
      ])
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_asset_idx')
      ).deep.equals([{ n: 1 }])
    } finally {
      await driver.close()
    }
  })

  it('writes a whole report or none of it', async function () {
    const driver = await makeDb()
    try {
      await saveTxs(driver, [
        makeTx({ txid: 'tx1', nativeAmounts: new Map([[null, '-1']]) }),
        makeTx({ txid: 'tx2', nativeAmounts: new Map([[null, '-2']]) }),
        makeTx({ txid: 'tx3', nativeAmounts: new Map([[null, '-3']]) })
      ])

      expect(
        await driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 3 }])
    } finally {
      await driver.close()
    }
  })

  it('does nothing for an empty report', async function () {
    const driver = await makeDb()
    try {
      await saveTxs(driver, [])
      expect(
        await driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 0 }])
    } finally {
      await driver.close()
    }
  })
})

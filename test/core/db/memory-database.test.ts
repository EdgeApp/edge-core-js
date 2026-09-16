import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeMemoryTxDatabase } from '../../../src/index'

/**
 * The handle a plugin's own tests get.
 *
 * A plugin moving onto `EdgeTxDatabase` has to be able to test against the
 * real schema, triggers and authorizer without standing up an account. If
 * this is awkward to use, every plugin migration gets a hand-rolled fake
 * instead -- and then the tests stop saying anything about the real thing.
 */
describe('memory transaction database', function () {
  it('gives a plugin working storage', async function () {
    const db = await makeMemoryTxDatabase({
      walletId: Buffer.alloc(32, 0x11).toString('base64'),
      pluginId: 'bitcoin'
    })

    await db.defineTables({
      version: 1,
      tables: {
        utxo: { key: ['id'], indexes: { spendable: { paths: ['$.spent'] } } }
      }
    })
    await db.putRows([
      { table: 'utxo', rows: [{ id: 'u1', spent: false }] },
      { table: 'utxo', rows: [{ id: 'u2', spent: true }] }
    ])

    expect(
      (await db.findRows('utxo', { equals: { '$.spent': false } })).length
    ).equals(1)
  })

  it('stores transactions and reads them back', async function () {
    const walletId = Buffer.alloc(32, 0x11).toString('base64')
    const db = await makeMemoryTxDatabase({ walletId, pluginId: 'bitcoin' })

    await db.saveTxs([
      {
        walletId,
        txid: 'tx1',
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
    ])

    const txs = await db.getTxs()
    expect(txs.length).equals(1)
    expect(txs[0].nativeAmounts.get(null)).equals('-100')
  })

  it('is fenced like the real thing', async function () {
    const db = await makeMemoryTxDatabase({
      walletId: Buffer.alloc(32, 0x11).toString('base64'),
      pluginId: 'bitcoin'
    })

    // A plugin testing against this has to hit the same wall it will hit in
    // production, or the test is a fake that agrees with itself.
    let failed = false
    try {
      await db.runSql`SELECT * FROM tx_chain`
    } catch (error) {
      failed = true
    }
    expect(failed).equals(true)
  })
})

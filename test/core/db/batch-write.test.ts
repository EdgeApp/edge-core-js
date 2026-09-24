import { expect } from 'chai'
import { describe, it } from 'mocha'

import { batchWrite } from '../../../src/core/db/batch-write'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { prepareDatabase } from '../../../src/core/db/db-open'
import { getRows } from '../../../src/core/db/plugin-rows'
import { defineTables } from '../../../src/core/db/plugin-tables'
import { readTx } from '../../../src/core/db/tx-query'
import { makeMemorySqlDriver } from '../../../src/io/node/node-sql-driver'
import { EdgeTableSpec, EdgeTx } from '../../../src/types/types'
import { expectRejection } from '../../expect-rejection'

/**
 * Atomic writes across transactions and plugin tables.
 *
 * The two flows this exists for both lose coins today. A send saves the
 * transaction and then the UTXOs it created; an RBF replacement removes the
 * inputs it spends before saving the replacement. Interrupted in the middle,
 * the first understates the balance by the change and the second loses UTXOs
 * with nothing to account for them.
 */

const WALLET_ID = Buffer.alloc(32, 0x11).toString('base64')

const spec: EdgeTableSpec = {
  version: 1,
  tables: { utxo: { key: ['id'] } }
}

function makeTx(overrides: Partial<EdgeTx> = {}): EdgeTx {
  return {
    walletId: WALLET_ID,
    txid: 'tx1',
    pluginId: 'bitcoin',
    date: '2024-06-01T12:00:00.000Z',
    blockHeight: 0,
    isSend: true,
    nativeAmounts: new Map([[null, '-100']]),
    networkFees: new Map([[null, '10']]),
    ourReceiveAddresses: [],
    memos: [],
    tokenData: new Map(),
    ...overrides
  }
}

interface Fixture {
  driver: EdgeSqlDriver
  prefix: string
  context: {
    driver: EdgeSqlDriver
    walletId: string
    prefix: string
    spec: EdgeTableSpec
  }
}

async function setup(): Promise<Fixture> {
  const driver = makeMemorySqlDriver()
  await prepareDatabase(driver)
  const { prefix } = await defineTables(driver, {
    walletId: WALLET_ID,
    pluginId: 'bitcoin',
    spec
  })
  return {
    driver,
    prefix,
    context: { driver, walletId: WALLET_ID, prefix, spec }
  }
}

async function utxoIds(fixture: Fixture): Promise<string[]> {
  const rows = await fixture.driver.query<{ key: string }>(
    `SELECT key FROM "${fixture.prefix}utxo" ORDER BY key`
  )
  return rows.map(row => row.key)
}

describe('batchWrite', function () {
  it('keeps the nulls a second report of a transaction carries', async function () {
    const { driver, context } = await setup()
    try {
      // `tokenId: null` is the chain's own asset. A merge that read a null
      // as "delete this key" would drop it, and the stored transaction would
      // then fail its own cleaner:
      const savedAction = {
        actionType: 'swap' as const,
        swapInfo: {
          pluginId: 'swapper',
          displayName: 'Swapper',
          isDex: false,
          supportEmail: ''
        },
        fromAsset: { pluginId: 'bitcoin', tokenId: null, nativeAmount: '1' },
        toAsset: { pluginId: 'ethereum', tokenId: 'usdc', nativeAmount: '2' },
        payoutAddress: 'there',
        payoutWalletId: 'wallet'
      }
      await batchWrite(context, { saveTxs: [makeTx()] })
      await batchWrite(context, { saveTxs: [makeTx({ savedAction })] })
      await batchWrite(context, { saveTxs: [makeTx({ savedAction })] })

      const tx = await readTx(driver, WALLET_ID, 'tx1')
      const action: any = tx?.savedAction
      expect(action.fromAsset).deep.equals(savedAction.fromAsset)
      expect(action.toAsset).deep.equals(savedAction.toAsset)
    } finally {
      await driver.close()
    }
  })

  it('lands a send and its coins together', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, {
        saveTxs: [makeTx()],
        putRows: [{ table: 'utxo', rows: [{ id: 'u1' }, { id: 'u2' }] }]
      })

      expect(await readTx(fixture.driver, WALLET_ID, 'tx1')).does.not.equal(
        undefined
      )
      expect(await utxoIds(fixture)).deep.equals(['u1', 'u2'])
    } finally {
      await fixture.driver.close()
    }
  })

  it('rolls the whole unit back when any part fails', async function () {
    const fixture = await setup()
    try {
      await expectRejection(
        batchWrite(fixture.context, {
          saveTxs: [makeTx()],
          // No key, so this statement cannot be built -- and the transaction
          // above must not survive it.
          putRows: [{ table: 'utxo', rows: [{ notAnId: 'u1' }] }]
        })
      )

      expect(await readTx(fixture.driver, WALLET_ID, 'tx1')).equals(undefined)
      expect(await utxoIds(fixture)).deep.equals([])
    } finally {
      await fixture.driver.close()
    }
  })

  it('writes the RBF replacement as one unit', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, {
        saveTxs: [makeTx({ txid: 'original' })],
        putRows: [{ table: 'utxo', rows: [{ id: 'spent1' }, { id: 'keep' }] }]
      })

      // The inputs it spends, the replacement itself, and the demotion of the
      // transaction it replaces -- four writes under three different mutexes
      // today, with two interruption points that lose coins.
      await batchWrite(fixture.context, {
        removeRows: [{ table: 'utxo', keys: ['spent1'] }],
        putRows: [{ table: 'utxo', rows: [{ id: 'new1' }] }],
        saveTxs: [makeTx({ txid: 'replacement' })],
        patchTxs: [{ txid: 'original', blockHeight: -1 }]
      })

      expect(await utxoIds(fixture)).deep.equals(['keep', 'new1'])
      expect(
        (await readTx(fixture.driver, WALLET_ID, 'original'))?.blockHeight
      ).equals(-1)
      expect(
        await readTx(fixture.driver, WALLET_ID, 'replacement')
      ).does.not.equal(undefined)
    } finally {
      await fixture.driver.close()
    }
  })

  it('patches one field and leaves the rest alone', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, { saveTxs: [makeTx()] })
      await batchWrite(fixture.context, {
        patchTxs: [{ txid: 'tx1', blockHeight: 900000 }]
      })

      const tx = await readTx(fixture.driver, WALLET_ID, 'tx1')
      expect(tx?.blockHeight).equals(900000)
      expect(tx?.nativeAmounts.get(null)).equals('-100')
      expect(tx?.date).equals('2024-06-01T12:00:00.000Z')
    } finally {
      await fixture.driver.close()
    }
  })

  it('merges a keyed field without losing what is there', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, { saveTxs: [makeTx()] })
      await batchWrite(fixture.context, {
        patchTxs: [{ txid: 'tx1', nativeAmounts: new Map([['abc', '50']]) }]
      })

      const tx = await readTx(fixture.driver, WALLET_ID, 'tx1')
      expect(tx?.nativeAmounts.get(null)).equals('-100')
      expect(tx?.nativeAmounts.get('abc')).equals('50')
    } finally {
      await fixture.driver.close()
    }
  })

  it('refuses to patch a transaction that is not there', async function () {
    const fixture = await setup()
    try {
      // Merge-patch cannot tell a partial update from a malformed create, so
      // this would otherwise insert a transaction with no date and no
      // amounts, and the failure would surface later as a corrupt row.
      await expectRejection(
        batchWrite(fixture.context, {
          patchTxs: [{ txid: 'ghost', blockHeight: 900000 }]
        })
      )
      expect(
        await fixture.driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 0 }])
    } finally {
      await fixture.driver.close()
    }
  })

  it('rolls back a batch whose patch is impossible', async function () {
    const fixture = await setup()
    try {
      await expectRejection(
        batchWrite(fixture.context, {
          putRows: [{ table: 'utxo', rows: [{ id: 'u1' }] }],
          patchTxs: [{ txid: 'ghost', blockHeight: 1 }]
        })
      )
      // The rows must not survive the failed patch:
      expect(await utxoIds(fixture)).deep.equals([])
    } finally {
      await fixture.driver.close()
    }
  })

  it('applies removals before writes', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, {
        putRows: [{ table: 'utxo', rows: [{ id: 'u1', v: 1 }] }]
      })

      // A caller that removes and re-adds the same key in one call gets a
      // defined result rather than whichever statement happened to be last.
      await batchWrite(fixture.context, {
        removeRows: [{ table: 'utxo', keys: ['u1'] }],
        putRows: [{ table: 'utxo', rows: [{ id: 'u1', v: 2 }] }]
      })

      const [result] = await getRows(fixture.driver, fixture.prefix, spec, [
        { table: 'utxo', keys: ['u1'] }
      ])
      expect((result.rows[0] as any).v).equals(2)
    } finally {
      await fixture.driver.close()
    }
  })

  it('writes under the handle wallet, whatever the object says', async function () {
    const fixture = await setup()
    try {
      // A plugin cannot address another wallet's transaction even by naming
      // one: identity comes from the handle it was given.
      await batchWrite(fixture.context, {
        saveTxs: [makeTx({ walletId: 'someone-elses-wallet' })]
      })

      expect(
        await fixture.driver.query('SELECT wallet_id FROM tx_chain')
      ).deep.equals([{ wallet_id: WALLET_ID }])
    } finally {
      await fixture.driver.close()
    }
  })

  it('updates the index inside the same transaction', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, { saveTxs: [makeTx()] })
      // A rolled-back write must leave no index residue, which means the
      // triggers have to run inside the boundary rather than after it.
      expect(
        await fixture.driver.query('SELECT count(*) AS n FROM tx_asset_idx')
      ).deep.equals([{ n: 1 }])

      await expectRejection(
        batchWrite(fixture.context, {
          saveTxs: [makeTx({ txid: 'tx2' })],
          putRows: [{ table: 'utxo', rows: [{ noId: true }] }]
        })
      )
      expect(
        await fixture.driver.query('SELECT count(*) AS n FROM tx_asset_idx')
      ).deep.equals([{ n: 1 }])
    } finally {
      await fixture.driver.close()
    }
  })

  it('enforces the patch check in SQL, not only before the batch', async function () {
    const fixture = await setup()
    try {
      // The pre-check exists so the error names the transaction. What makes
      // it atomic is the statement that follows every patch: it writes a NULL
      // document when the row was not there, and the schema refuses one. This
      // asserts that mechanism directly, since the pre-check would otherwise
      // be the only thing these tests ever exercise.
      await expectRejection(
        fixture.driver.batch([
          {
            sql: `INSERT INTO tx_chain (wallet_id, txid, doc)
                  SELECT ?, ?, NULL
                   WHERE NOT EXISTS (
                     SELECT 1 FROM tx_chain WHERE wallet_id = ? AND txid = ?
                   )`,
            params: [WALLET_ID, 'ghost', WALLET_ID, 'ghost']
          }
        ])
      )
    } finally {
      await fixture.driver.close()
    }
  })

  it('does nothing for an empty batch', async function () {
    const fixture = await setup()
    try {
      await batchWrite(fixture.context, {})
      expect(
        await fixture.driver.query('SELECT count(*) AS n FROM tx_chain')
      ).deep.equals([{ n: 0 }])
    } finally {
      await fixture.driver.close()
    }
  })
})

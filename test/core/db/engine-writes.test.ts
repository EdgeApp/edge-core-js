import { expect } from 'chai'
import { describe, it } from 'mocha'

import { openAccountDatabases } from '../../../src/core/db/account-database'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import { makeFakeEdgeWorld } from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

/**
 * Engine transactions reaching the database.
 *
 * This is the transitional path, and what makes the migration incremental: an
 * engine that knows nothing about the database still populates it, because
 * the core translates what it already reports through `onTransactions`.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true },
  transactionDatabase: true
}

interface Fixture {
  driver: EdgeSqlDriver
  /** The account has more than one fakecoin wallet, and both engines report
   * whatever the shared plugin config says -- so every query here is scoped. */
  walletId: string
  changeTxs: (txs: object) => Promise<void>
  logout: () => Promise<void>
}

async function setup(): Promise<Fixture> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  await account.waitForCurrencyWallet(walletInfo.id)

  const database = openAccountDatabases.get([...openAccountDatabases.keys()][0])
  if (database == null) throw new Error('No database was opened')

  return {
    driver: database.driver,
    walletId: walletInfo.id,
    changeTxs: async txs =>
      await account.currencyConfig.fakecoin.changeUserSettings({ txs }),
    logout: async () => await account.logout()
  }
}

/**
 * Waits for the database to catch up.
 *
 * The write is deliberately not awaited by the callback -- a disk write must
 * not be able to stall an engine -- so a test has to wait for it the way the
 * GUI would.
 */
async function waitForRows<T>(
  driver: EdgeSqlDriver,
  sql: string,
  count: number
): Promise<T[]> {
  for (let i = 0; i < 100; ++i) {
    const rows = await driver.query<T>(sql)
    if (rows.length >= count) return rows
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Only ever saw fewer than ${count} rows for: ${sql}`)
}

describe('engine transactions', function () {
  it('land in the database', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({
        a: { nativeAmount: '1' },
        b: { nativeAmount: '100' }
      })

      const rows = await waitForRows<{ txid: string; plugin_id: string }>(
        fixture.driver,
        `SELECT txid, plugin_id FROM tx_chain
          WHERE wallet_id = '${fixture.walletId}' ORDER BY txid`,
        2
      )
      expect(rows).deep.equals([
        { txid: 'a', plugin_id: 'fakecoin' },
        { txid: 'b', plugin_id: 'fakecoin' }
      ])
    } finally {
      await fixture.logout()
    }
  })

  it('are indexed for querying', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({ a: { nativeAmount: '1' } })

      const rows = await waitForRows<{
        txid: string
        token_id: string
        has_chain: number
        native_amount_key: string
      }>(
        fixture.driver,
        `SELECT txid, token_id, has_chain, native_amount_key
           FROM tx_asset_idx WHERE wallet_id = '${fixture.walletId}'`,
        1
      )
      expect(rows[0].txid).equals('a')
      expect(rows[0].token_id).equals('')
      expect(rows[0].has_chain).equals(1)
      expect(rows[0].native_amount_key).does.not.equal(null)
    } finally {
      await fixture.logout()
    }
  })

  it('update in place when the engine reports again', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({ a: { nativeAmount: '1', blockHeight: 0 } })
      await waitForRows(
        fixture.driver,
        `SELECT * FROM tx_chain WHERE wallet_id = '${fixture.walletId}'`,
        1
      )

      // Confirmation, which is what most second reports are:
      await fixture.changeTxs({ a: { nativeAmount: '1', blockHeight: 500 } })

      for (let i = 0; i < 100; ++i) {
        const rows = await fixture.driver.query<{ block_height: number }>(
          `SELECT block_height FROM tx_chain
            WHERE wallet_id = '${fixture.walletId}'`
        )
        if (rows[0]?.block_height === 500) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      expect(
        await fixture.driver.query(
          `SELECT block_height FROM tx_chain
            WHERE wallet_id = '${fixture.walletId}'`
        )
      ).deep.equals([{ block_height: 500 }])
      // Still one transaction, not two:
      expect(
        await fixture.driver.query(
          `SELECT count(*) AS n FROM tx_chain
            WHERE wallet_id = '${fixture.walletId}'`
        )
      ).deep.equals([{ n: 1 }])
    } finally {
      await fixture.logout()
    }
  })

  it('keep the date the engine reported', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({ a: { nativeAmount: '1', date: 1717243200 } })
      const rows = await waitForRows<{ date: number; iso: string }>(
        fixture.driver,
        `SELECT date, json(doc) ->> '$.date' AS iso FROM tx_chain
          WHERE wallet_id = '${fixture.walletId}'`,
        1
      )

      // `EdgeTransaction.date` is seconds; `EdgeTx.date` is ISO 8601. The
      // generated column has to read the second one back as the first.
      expect(rows[0].iso).equals('2024-06-01T12:00:00.000Z')
      expect(rows[0].date).equals(1717243200)
    } finally {
      await fixture.logout()
    }
  })
})

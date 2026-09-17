import { expect } from 'chai'
import { describe, it } from 'mocha'

import { openAccountDatabases } from '../../../src/core/db/account-database'
import { EdgeSqlDriver } from '../../../src/core/db/db-driver'
import {
  EdgeAccount,
  EdgeCurrencyWallet,
  makeFakeEdgeWorld
} from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

/**
 * `EdgeCurrencyWallet` reading its transactions out of the database.
 *
 * The path this replaces walked every txid the engine had ever reported and
 * opened a metadata file per transaction, so the first page cost the size of
 * the wallet. These check the swap kept what a reader actually consumes: the
 * amounts, the confirmation state, the user's metadata, and the filters.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true },
  transactionDatabase: true
}

interface Fixture {
  account: EdgeAccount
  wallet: EdgeCurrencyWallet
  driver: EdgeSqlDriver
  changeTxs: (txs: object) => Promise<void>
  logout: () => Promise<void>
}

async function setup(): Promise<Fixture> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)

  const database = openAccountDatabases.get([...openAccountDatabases.keys()][0])
  if (database == null) throw new Error('No database was opened')

  return {
    account,
    wallet,
    driver: database.driver,
    changeTxs: async txs =>
      await account.currencyConfig.fakecoin.changeUserSettings({ txs }),
    logout: async () => await account.logout()
  }
}

/**
 * Waits for a read to see what an engine reported.
 *
 * The write is deliberately not awaited by the callback -- a disk write must
 * not be able to stall an engine -- so a reader has to wait for it the way
 * the GUI would.
 */
async function waitForTxs(
  wallet: EdgeCurrencyWallet,
  count: number
): Promise<any[]> {
  for (let i = 0; i < 100; ++i) {
    const txs = await wallet.getTransactions({ tokenId: null })
    if (txs.length >= count) return txs
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Never saw ${count} transactions`)
}

describe('wallet transaction reads', function () {
  it('returns what the engine reported', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({
        a: { nativeAmount: '1', blockHeight: 500 },
        b: { nativeAmount: '-100', blockHeight: 500 }
      })

      const txs = await waitForTxs(fixture.wallet, 2)
      const byTxid = new Map(txs.map(tx => [tx.txid, tx]))
      expect(byTxid.get('a')?.nativeAmount).equals('1')
      expect(byTxid.get('b')?.nativeAmount).equals('-100')
      expect(byTxid.get('a')?.currencyCode).equals('FAKE')
      expect(byTxid.get('a')?.tokenId).equals(null)
      expect(byTxid.get('a')?.walletId).equals(fixture.wallet.id)
    } finally {
      await fixture.logout()
    }
  })

  it('counts transactions without returning them', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({ a: { nativeAmount: '1' }, b: {} })
      await waitForTxs(fixture.wallet, 2)

      expect(await fixture.wallet.getNumTransactions({ tokenId: null })).equals(
        2
      )
    } finally {
      await fixture.logout()
    }
  })

  it('works out the confirmation state from the heights', async function () {
    const fixture = await setup()
    try {
      // Never stored, because it follows from this transaction's height and
      // the wallet's -- storing it would stale every transaction in the
      // wallet each time a block arrived.
      await fixture.changeTxs({ a: { nativeAmount: '1', blockHeight: 0 } })
      const [pending] = await waitForTxs(fixture.wallet, 1)
      expect(pending.confirmations).equals('unconfirmed')
    } finally {
      await fixture.logout()
    }
  })

  it('returns the metadata the user saved', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({ a: { nativeAmount: '1', blockHeight: 500 } })
      await waitForTxs(fixture.wallet, 1)

      await fixture.wallet.saveTxMetadata({
        txid: 'a',
        tokenId: null,
        metadata: { name: 'Alice', notes: 'rent', category: 'Expense:Rent' }
      })

      for (let i = 0; i < 100; ++i) {
        const [tx] = await fixture.wallet.getTransactions({ tokenId: null })
        if (tx?.metadata?.name === 'Alice') break
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const [tx] = await fixture.wallet.getTransactions({ tokenId: null })
      expect(tx.metadata?.name).equals('Alice')
      expect(tx.metadata?.notes).equals('rent')
      expect(tx.metadata?.category).equals('Expense:Rent')
    } finally {
      await fixture.logout()
    }
  })

  it('pages rather than returning everything at once', async function () {
    const fixture = await setup()
    try {
      const txs: { [txid: string]: object } = {}
      for (let i = 0; i < 12; ++i) {
        txs[`tx${String(i).padStart(2, '0')}`] = {
          nativeAmount: '1',
          blockHeight: 500 + i
        }
      }
      await fixture.changeTxs(txs)
      await waitForTxs(fixture.wallet, 12)

      const seen: string[] = []
      for await (const batch of await fixture.wallet.streamTransactions({
        tokenId: null,
        batchSize: 5
      })) {
        expect(batch.length).is.at.most(5)
        seen.push(...batch.map(tx => tx.txid))
      }
      expect(new Set(seen).size).equals(12)
    } finally {
      await fixture.logout()
    }
  })

  it('filters by date', async function () {
    const fixture = await setup()
    try {
      await fixture.changeTxs({
        old: { nativeAmount: '1', blockHeight: 500, date: 1000000 },
        recent: { nativeAmount: '1', blockHeight: 500, date: 2000000 }
      })
      await waitForTxs(fixture.wallet, 2)

      const txs = await fixture.wallet.getTransactions({
        tokenId: null,
        startDate: new Date(1500000 * 1000)
      })
      expect(txs.map(tx => tx.txid)).deep.equals(['recent'])
    } finally {
      await fixture.logout()
    }
  })
})

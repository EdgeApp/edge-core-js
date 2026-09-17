import { expect } from 'chai'
import { describe, it } from 'mocha'

import { openAccountDatabases } from '../../../src/core/db/account-database'
import { EdgeAccount, makeFakeEdgeWorld } from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'

/**
 * `transactionsChanged`.
 *
 * It carries identity only, and comes in batches: a rate backfill can touch
 * thousands of rows, and one event per row would swamp the bridge. So a
 * reader is told *which* transactions to re-read, never what they now say.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true },
  transactionDatabase: true
}

async function setup(): Promise<EdgeAccount> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext(contextOptions)
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  await account.waitForCurrencyWallet(walletInfo.id)
  return account
}

describe('transactionsChanged', function () {
  it('reports what an engine wrote', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')

      const seen: Array<{ walletId: string; txid: string }> = []
      store.on('transactionsChanged', refs => seen.push(...refs))

      await account.currencyConfig.fakecoin.changeUserSettings({
        txs: { a: { nativeAmount: '1' }, b: { nativeAmount: '2' } }
      })

      for (let i = 0; i < 200; ++i) {
        if (seen.length >= 2) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      expect(new Set(seen.map(ref => ref.txid))).deep.equals(
        new Set(['a', 'b'])
      )
      // Identity only -- the reader re-queries what it is showing:
      expect(new Set(Object.keys(seen[0]))).deep.equals(
        new Set(['txid', 'walletId'])
      )
    } finally {
      await account.logout()
    }
  })

  it('batches rather than firing per row', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')

      let events = 0
      let refs = 0
      store.on('transactionsChanged', batch => {
        ++events
        refs += batch.length
      })

      await account.currencyConfig.fakecoin.changeUserSettings({
        txs: {
          a: { nativeAmount: '1' },
          b: { nativeAmount: '2' },
          c: { nativeAmount: '3' },
          d: { nativeAmount: '4' }
        }
      })

      for (let i = 0; i < 200; ++i) {
        if (refs >= 4) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      expect(refs).is.at.least(4)
      // Both fakecoin wallets report, so a per-row event would be eight.
      expect(events).is.below(4)
    } finally {
      await account.logout()
    }
  })

  it('stops when the account logs out', async function () {
    const account = await setup()
    const store = account.transactions
    if (store == null) throw new Error('No transaction store')
    await account.logout()
    expect(openAccountDatabases.size).equals(0)
  })
})

describe('localSettings.defaultIsoFiat', function () {
  it('is undefined until something sets it', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')
      // A real state: an account with no currency chosen has no correct
      // amount to show.
      expect(store.localSettings.defaultIsoFiat).equals(undefined)
    } finally {
      await account.logout()
    }
  })

  it('remembers what it was set to', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')

      await store.changeLocalSettings({ defaultIsoFiat: 'iso:EUR' })
      expect(store.localSettings.defaultIsoFiat).equals('iso:EUR')
    } finally {
      await account.logout()
    }
  })

  it('tells readers to repaint when it really changes', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')
      await account.currencyConfig.fakecoin.changeUserSettings({
        txs: { a: { nativeAmount: '1' } }
      })

      let events = 0
      store.on('transactionsChanged', () => ++events)
      await store.changeLocalSettings({ defaultIsoFiat: 'iso:USD' })

      for (let i = 0; i < 200; ++i) {
        if (events > 0) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      // Everything is blank now, and a reader showing the old currency's
      // amounts has to stop.
      expect(events).is.above(0)
    } finally {
      await account.logout()
    }
  })

  it('does nothing when set to what it already is', async function () {
    const account = await setup()
    try {
      const store = account.transactions
      if (store == null) throw new Error('No transaction store')
      await store.changeLocalSettings({ defaultIsoFiat: 'iso:USD' })

      let events = 0
      store.on('transactionsChanged', () => ++events)
      await store.changeLocalSettings({ defaultIsoFiat: 'iso:USD' })
      await new Promise(resolve => setTimeout(resolve, 400))

      // A setter that is not a no-op re-rates the whole account on each boot.
      expect(events).equals(0)
    } finally {
      await account.logout()
    }
  })
})

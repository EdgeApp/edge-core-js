import { expect } from 'chai'
import { afterEach, describe, it } from 'mocha'

import { txMetaMirrorConfig } from '../../../src/core/db/tx-meta-mirror'
import { MAX_LIMIT } from '../../../src/core/db/tx-query'
import { txWriteQueueConfig } from '../../../src/core/db/tx-write-queue'
import { fakeWorldTestConfig } from '../../../src/core/fake/fake-world'
import {
  EdgeAccount,
  EdgeContext,
  EdgeCurrencyWallet,
  EdgeFakeWorld,
  EdgeTransaction,
  makeFakeEdgeWorld
} from '../../../src/index'
import { fakeUser } from '../../fake/fake-user'
import { findTestDatabase } from '../../fake/wallet-cache-rows'

/**
 * What a wallet tells its listeners, now that it reads its transactions from
 * the database.
 *
 * An event carries the transaction as a query would return it, so it carries
 * the user's metadata the way a page of the list does. A reader that overlays
 * a changed transaction on its list would otherwise blank the name it was
 * already showing.
 */

const quiet = { onLog() {} }
const contextOptions = {
  apiKey: '',
  appId: '',
  plugins: { fakecoin: true }
}

interface Fixture {
  world: EdgeFakeWorld
  context: EdgeContext
  account: EdgeAccount
  wallet: EdgeCurrencyWallet
  events: EdgeTransaction[]
  changeSettings: (settings: object) => Promise<void>
}

async function setup(world?: EdgeFakeWorld, device?: string): Promise<Fixture> {
  world ??= await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({ ...contextOptions, device })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)

  const events: EdgeTransaction[] = []
  wallet.on('transactionsChanged', txs => events.push(...txs))
  wallet.on('newTransactions', txs => events.push(...txs))

  return {
    world,
    context,
    account,
    wallet,
    events,
    changeSettings: async settings =>
      await account.currencyConfig.fakecoin.changeUserSettings(settings)
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string
): Promise<void> {
  for (let i = 0; i < 300; ++i) {
    if (await condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function waitForTx(
  wallet: EdgeCurrencyWallet,
  txid: string
): Promise<EdgeTransaction> {
  let found: EdgeTransaction | undefined
  await waitFor(async () => {
    const txs = await wallet.getTransactions({ tokenId: null })
    found = txs.find(tx => tx.txid === txid)
    return found != null
  }, `transaction ${txid}`)
  return found as EdgeTransaction
}

function lastEventFor(
  events: EdgeTransaction[],
  txid: string
): EdgeTransaction | undefined {
  return events.filter(tx => tx.txid === txid).pop()
}

async function metaRow(
  account: EdgeAccount,
  walletId: string,
  txid: string
): Promise<{ name?: string; fileDirty?: number } | undefined> {
  const { driver } = await findTestDatabase(account)
  const rows = await driver.query<{ doc: string }>(
    'SELECT json(doc) AS doc FROM tx_meta WHERE wallet_id = ? AND txid = ?',
    [walletId, txid]
  )
  if (rows.length === 0) return
  const doc = JSON.parse(rows[0].doc)
  return {
    name: doc.tokens?.['']?.metadata?.name,
    fileDirty: doc.fileDirty
  }
}

describe('wallet events', function () {
  afterEach(function () {
    txWriteQueueConfig.firstRetryMs = 1000
    txWriteQueueConfig.beforeSave = undefined
    fakeWorldTestConfig.failWrite = undefined
    txMetaMirrorConfig.chunkSize = 50
    txMetaMirrorConfig.beforeChunk = undefined
  })

  it('carries the saved metadata on an engine update', async function () {
    const fixture = await setup()
    const { wallet, events } = fixture
    try {
      await fixture.changeSettings({ txs: { a: { nativeAmount: '1' } } })
      await waitForTx(wallet, 'a')
      await wallet.saveTxMetadata({
        txid: 'a',
        tokenId: null,
        metadata: { name: 'Bob', category: 'Income:Salary' }
      })
      await waitFor(
        () => lastEventFor(events, 'a')?.metadata?.name === 'Bob',
        'the edit event'
      )

      // The engine's own update carries nothing but the chain's view:
      events.length = 0
      await fixture.changeSettings({
        txs: { a: { nativeAmount: '1', blockHeight: 5 } }
      })
      await waitFor(() => lastEventFor(events, 'a') != null, 'the update')
      const event = lastEventFor(events, 'a')
      expect(event?.blockHeight).equals(5)
      expect(event?.metadata?.name).equals('Bob')
      expect(event?.metadata?.category).equals('Income:Salary')
    } finally {
      await fixture.account.logout()
    }
  })

  it('reports a batch still retrying only once it lands', async function () {
    const fixture = await setup()
    const { wallet, events } = fixture
    try {
      txWriteQueueConfig.firstRetryMs = 30
      let failures = 3
      txWriteQueueConfig.beforeSave = () => {
        if (failures-- > 0) throw new Error('Disk is busy')
      }

      await fixture.changeSettings({ txs: { late: { nativeAmount: '7' } } })
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(lastEventFor(events, 'late')).equals(undefined)

      await waitFor(() => lastEventFor(events, 'late') != null, 'the event')
      expect(lastEventFor(events, 'late')?.nativeAmount).equals('7')
      expect((await waitForTx(wallet, 'late')).nativeAmount).equals('7')
    } finally {
      await fixture.account.logout()
    }
  })

  it('re-reports a transaction when a block confirms it', async function () {
    const fixture = await setup()
    const { wallet, events } = fixture
    try {
      await fixture.changeSettings({ blockHeight: 50 })
      await fixture.changeSettings({
        txs: { h: { nativeAmount: '1', blockHeight: 100 } }
      })
      expect((await waitForTx(wallet, 'h')).confirmations).equals('syncing')
      await wallet.saveTxMetadata({
        txid: 'h',
        tokenId: null,
        metadata: { name: 'Height' }
      })
      await waitFor(
        () => lastEventFor(events, 'h')?.metadata?.name === 'Height',
        'the edit event'
      )

      events.length = 0
      await fixture.changeSettings({ blockHeight: 100 })
      await waitFor(
        () => lastEventFor(events, 'h')?.confirmations === 'confirmed',
        'the confirmation'
      )
      expect(lastEventFor(events, 'h')?.metadata?.name).equals('Height')
    } finally {
      await fixture.account.logout()
    }
  })

  it('reports every transaction of a batch larger than a page', async function () {
    this.timeout(20000)
    const fixture = await setup()
    const { events } = fixture
    try {
      const count = MAX_LIMIT + 1
      const txs: { [txid: string]: object } = {}
      for (let i = 0; i < count; ++i) txs[`t${i}`] = { nativeAmount: '1' }
      await fixture.changeSettings({ txs })

      await waitFor(
        () => new Set(events.map(tx => tx.txid)).size >= count,
        `${count} events`
      )
      expect(new Set(events.map(tx => tx.txid)).size).equals(count)
    } finally {
      await fixture.account.logout()
    }
  })

  it('shows an edit at once, and keeps it when the file write fails', async function () {
    this.timeout(15000)
    const fixture = await setup(undefined, 'phone')
    const { account, wallet, events } = fixture
    try {
      await fixture.changeSettings({ txs: { a: { nativeAmount: '1' } } })
      await waitForTx(wallet, 'a')
      await wallet.saveTxMetadata({
        txid: 'a',
        tokenId: null,
        metadata: { name: 'Bob' }
      })
      expect((await metaRow(account, wallet.id, 'a'))?.name).equals('Bob')

      // No sync in between -- the row is written before the event:
      events.length = 0
      await wallet.saveTxMetadata({
        txid: 'a',
        tokenId: null,
        metadata: { name: 'Alice' }
      })
      await waitFor(
        () => lastEventFor(events, 'a')?.metadata?.name === 'Alice',
        'the event'
      )
      expect((await waitForTx(wallet, 'a')).metadata?.name).equals('Alice')

      // A file that will not write still leaves the edit in the row, flagged:
      fakeWorldTestConfig.failWrite = path => path.includes('transaction/')
      let rejected = false
      await wallet
        .saveTxMetadata({
          txid: 'a',
          tokenId: null,
          metadata: { name: 'Carol' }
        })
        .catch(() => (rejected = true))
      expect(rejected).equals(true)
      expect(await metaRow(account, wallet.id, 'a')).deep.equals({
        name: 'Carol',
        fileDirty: 1
      })
      fakeWorldTestConfig.failWrite = undefined

      // The next reload writes the file. A change from another device is
      // what makes a sync reload:
      const other = await fixture.world.makeEdgeContext(contextOptions)
      const otherAccount = await other.loginWithPIN(
        fakeUser.username,
        fakeUser.pin
      )
      const otherWallet = await otherAccount.waitForCurrencyWallet(wallet.id)
      await otherWallet.renameWallet('Renamed Elsewhere')
      await otherWallet.sync()
      await otherAccount.logout()

      await wallet.sync()
      await waitFor(
        async () => (await metaRow(account, wallet.id, 'a'))?.fileDirty === 0,
        'the flush'
      )
      expect((await metaRow(account, wallet.id, 'a'))?.name).equals('Carol')
    } finally {
      await account.logout()
    }
  })

  it('replaces only the rows a sync changed', async function () {
    this.timeout(15000)
    const fixture = await setup()
    const { account, wallet } = fixture
    try {
      await fixture.changeSettings({
        txs: { x: { nativeAmount: '1' }, y: { nativeAmount: '2' } }
      })
      await waitForTx(wallet, 'y')
      await wallet.saveTxMetadata({
        txid: 'x',
        tokenId: null,
        metadata: { name: 'X1' }
      })
      await wallet.saveTxMetadata({
        txid: 'y',
        tokenId: null,
        metadata: { name: 'Y1' }
      })
      await wallet.sync()

      const { driver } = await findTestDatabase(account)
      const readRow = async (txid: string): Promise<unknown> =>
        await driver.query(
          'SELECT rowid, json(doc) AS doc FROM tx_meta WHERE wallet_id = ? AND txid = ?',
          [wallet.id, txid]
        )
      const yBefore = await readRow('y')

      // Another device edits x only:
      const other = await fixture.world.makeEdgeContext(contextOptions)
      const otherAccount = await other.loginWithPIN(
        fakeUser.username,
        fakeUser.pin
      )
      const otherWallet = await otherAccount.waitForCurrencyWallet(wallet.id)
      await otherAccount.currencyConfig.fakecoin.changeUserSettings({
        txs: { x: { nativeAmount: '1' }, y: { nativeAmount: '2' } }
      })
      await otherWallet.sync()
      await waitForTx(otherWallet, 'x')
      await otherWallet.saveTxMetadata({
        txid: 'x',
        tokenId: null,
        metadata: { name: 'X2' }
      })
      await otherWallet.sync()
      await otherAccount.logout()

      await wallet.sync()
      await waitFor(
        async () => (await metaRow(account, wallet.id, 'x'))?.name === 'X2',
        'the synced edit'
      )
      expect(await readRow('y')).deep.equals(yBefore)
    } finally {
      await account.logout()
    }
  })
})

describe('one-shot metadata mirror', function () {
  afterEach(function () {
    txMetaMirrorConfig.chunkSize = 50
    txMetaMirrorConfig.beforeChunk = undefined
    fakeWorldTestConfig.failWrite = undefined
  })

  /**
   * A device whose database is new while its repo is not: the files are on
   * its disk, and no sync will ever mention them again. That is an upgrade
   * from a build with no database, or a database rebuilt from scratch.
   */
  async function makeDeviceWithFiles(): Promise<{
    world: EdgeFakeWorld
    walletId: string
  }> {
    const first = await setup(undefined, 'phone')
    const { account, wallet } = first
    await first.changeSettings({
      txs: {
        m1: { nativeAmount: '1' },
        m2: { nativeAmount: '2' },
        m3: { nativeAmount: '3' }
      }
    })
    await waitForTx(wallet, 'm3')
    for (const txid of ['m1', 'm2', 'm3']) {
      await wallet.saveTxMetadata({
        txid,
        tokenId: null,
        metadata: { name: `Name ${txid}`, notes: `Notes ${txid}` }
      })
    }
    await wallet.sync()

    // Forget every row, as a new database would:
    const { driver } = await findTestDatabase(account)
    await driver.exec([
      { sql: 'DELETE FROM tx_meta WHERE wallet_id = ?', params: [wallet.id] },
      {
        sql: 'UPDATE wallet SET meta_mirrored = 0 WHERE wallet_id = ?',
        params: [wallet.id]
      }
    ])
    await account.logout()
    return { world: first.world, walletId: wallet.id }
  }

  async function mirrored(
    account: EdgeAccount,
    walletId: string
  ): Promise<number | undefined> {
    const { driver } = await findTestDatabase(account)
    const rows = await driver.query<{ meta_mirrored: number }>(
      'SELECT meta_mirrored FROM wallet WHERE wallet_id = ?',
      [walletId]
    )
    return rows[0]?.meta_mirrored
  }

  it('copies every file into the database once', async function () {
    this.timeout(15000)
    const { world, walletId } = await makeDeviceWithFiles()

    const chunks: number[] = []
    txMetaMirrorConfig.beforeChunk = index => chunks.push(index)
    const next = await setup(world, 'phone')
    const seen: string[] = []
    next.account.transactions.on('transactionsChanged', refs =>
      seen.push(...refs.map(ref => ref.txid))
    )
    try {
      await waitFor(
        async () => (await mirrored(next.account, walletId)) === 1,
        'the mirror'
      )
      for (const txid of ['m1', 'm2', 'm3']) {
        expect((await metaRow(next.account, walletId, txid))?.name).equals(
          `Name ${txid}`
        )
      }
      await waitFor(
        () => ['m1', 'm2', 'm3'].every(txid => seen.includes(txid)),
        'the change reports'
      )
      expect(chunks.length).greaterThan(0)
    } finally {
      await next.account.logout()
    }

    // The next start on this device reads no file:
    chunks.length = 0
    const again = await setup(world, 'phone')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(chunks).deep.equals([])
    await again.account.logout()
  })

  it('leaves a newer row alone', async function () {
    this.timeout(15000)
    const { world, walletId } = await makeDeviceWithFiles()

    // Hold the mirror back for one session, and make an edit whose file
    // write fails, so its row is both newer and dirty:
    txMetaMirrorConfig.beforeChunk = () => {
      throw new Error('Not this session')
    }
    const held = await setup(world, 'phone')
    try {
      await held.changeSettings({ txs: { m1: { nativeAmount: '1' } } })
      await waitForTx(held.wallet, 'm1')
      fakeWorldTestConfig.failWrite = path => path.includes('transaction/')
      await held.wallet
        .saveTxMetadata({
          txid: 'm1',
          tokenId: null,
          metadata: { name: 'Newer' }
        })
        .catch(() => {})
      fakeWorldTestConfig.failWrite = undefined
      expect(await metaRow(held.account, walletId, 'm1')).deep.equals({
        name: 'Newer',
        fileDirty: 1
      })
    } finally {
      await held.account.logout()
    }

    // The next start mirrors the rest and keeps that row as it was. File
    // writes still fail, so the flush a sync runs cannot be what keeps it:
    txMetaMirrorConfig.beforeChunk = undefined
    fakeWorldTestConfig.failWrite = path => path.includes('transaction/')
    const next = await setup(world, 'phone')
    try {
      await waitFor(
        async () => (await mirrored(next.account, walletId)) === 1,
        'the mirror'
      )
      expect((await metaRow(next.account, walletId, 'm2'))?.name).equals(
        'Name m2'
      )
      expect(await metaRow(next.account, walletId, 'm1')).deep.equals({
        name: 'Newer',
        fileDirty: 1
      })
    } finally {
      await next.account.logout()
    }
  })

  it('finishes on the next start after stopping part-way', async function () {
    this.timeout(15000)
    const { world, walletId } = await makeDeviceWithFiles()

    txMetaMirrorConfig.chunkSize = 1
    let failed = false
    txMetaMirrorConfig.beforeChunk = index => {
      if (index === 1) {
        failed = true
        throw new Error('Killed')
      }
    }
    const killed = await setup(world, 'phone')
    try {
      await waitFor(() => failed, 'the second chunk')
      await new Promise(resolve => setTimeout(resolve, 50))
      expect((await mirrored(killed.account, walletId)) ?? 0).equals(0)
    } finally {
      await killed.account.logout()
    }

    txMetaMirrorConfig.beforeChunk = undefined
    const next = await setup(world, 'phone')
    try {
      await waitFor(
        async () => (await mirrored(next.account, walletId)) === 1,
        'the finished mirror'
      )
      const { driver } = await findTestDatabase(next.account)
      const count = await driver.query<{ n: number }>(
        'SELECT count(*) AS n FROM tx_meta WHERE wallet_id = ?',
        [walletId]
      )
      expect(count).deep.equals([{ n: 3 }])
    } finally {
      await next.account.logout()
    }
  })
})

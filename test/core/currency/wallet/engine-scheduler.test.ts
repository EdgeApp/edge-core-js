import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'

import {
  engineSchedulerConfig,
  getEngineScheduler
} from '../../../../src/core/currency/wallet/engine-scheduler'
import { walletCacheSaverConfig } from '../../../../src/core/currency/wallet/wallet-cache-file'
import { EdgeContext, makeFakeEdgeWorld } from '../../../../src/index'
import { snooze } from '../../../../src/util/snooze'
import {
  createEngineGate,
  fakePluginTestConfig
} from '../../../fake/fake-currency-plugin'
import { fakeUser } from '../../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '', deviceDescription: 'iphone12' }
const quiet = { onLog() {} }

// Generous wait for the throttled cache saver (50ms in tests) to write:
const SAVE_WAIT_MS = 300

// Short wait to prove something has *not* happened:
const RACE_WAIT_MS = 150

interface MultiWalletWorld {
  context: EdgeContext
  walletIds: string[]
}

/**
 * Logs in once, pads the account out to at least `count` fakecoin
 * wallets, waits for their cache files to persist, and logs out.
 * The next login on the returned context is a warm start where every
 * wallet's engine startup enters the scheduler queue. The returned
 * ids cover EVERY wallet in the account (the fake user starts with
 * two), so length comparisons against engine-creation counts hold.
 */
async function makeMultiWalletWorld(count: number): Promise<MultiWalletWorld> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { fakecoin: true }
  })

  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const walletIds = account.activeWalletIds.filter(
    walletId => account.getWalletInfo(walletId)?.type === 'wallet:fakecoin'
  )
  if (walletIds.length !== account.activeWalletIds.length) {
    throw new Error('Broken test account: unexpected non-fakecoin wallets')
  }
  while (walletIds.length < count) {
    const wallet = await account.createCurrencyWallet('wallet:fakecoin', {
      fiatCurrencyCode: 'iso:USD',
      name: `Wallet ${walletIds.length}`
    })
    walletIds.push(wallet.id)
  }

  // Let the throttled saver persist each wallet's cache file:
  await snooze(SAVE_WAIT_MS)
  await account.logout()

  return { context, walletIds }
}

/** Returns a sorted copy, so order-insensitive comparisons read cleanly. */
function sorted(list: string[]): string[] {
  return [...list].sort((a, b) => a.localeCompare(b))
}

/** Polls until `condition` holds, or fails the test after ~5s. */
async function pollUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; ++i) {
    if (condition()) return
    await snooze(50)
  }
  throw new Error('Timed out waiting for a test condition')
}

describe('engine scheduler', function () {
  beforeEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.onEngineCreate = undefined
    walletCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.onEngineCreate = undefined
    walletCacheSaverConfig.throttleMs = 5000
    engineSchedulerConfig.concurrency = 8
    engineSchedulerConfig.slotTimeoutMs = 30000
    engineSchedulerConfig.stickyBumpTtlMs = 30000
  })

  it('runs cached startup work at the configured concurrency', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(3)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Every wallet emits from its cache while the queue is stuck:
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )

    // The gate blocks the slot holder inside `makeCurrencyEngine`,
    // so with one slot, exactly one creation can begin. Wait for it
    // (a fixed sleep would flake on slow machines), then hold long
    // enough to prove no second creation sneaks through:
    await pollUntil(() => created.length === 1)
    await snooze(RACE_WAIT_MS)
    expect(created.length).equals(1)

    // Releasing the gate drains the queue one wallet at a time,
    // and every engine still starts:
    release()
    await pollUntil(() => created.length === walletIds.length)
    expect(sorted(created)).deep.equals(sorted(walletIds))
    await account.logout()
  })

  it('waitForCurrencyWallet moves a queued wallet to the front', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(4)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )
    await pollUntil(() => created.length === 1)

    // Pick the wallet at the back of the line and ask for it:
    const queued = walletIds.filter(walletId => !created.includes(walletId))
    const target = queued[queued.length - 1]
    await account.waitForCurrencyWallet(target)

    // Once the slot frees up, the bumped wallet goes next:
    release()
    await pollUntil(() => created.length === walletIds.length)
    expect(created[1]).equals(target)
    await account.logout()
  })

  it('cold wallets skip the queue entirely', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(3)

    // Erase the cache files, making the next login a cold start.
    // Let the login's own cache save settle first, so nothing
    // rewrites the files after the deletes:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()
    await snooze(SAVE_WAIT_MS)
    for (const walletId of walletIds) {
      const wallet = await account.waitForCurrencyWallet(walletId)
      await wallet.localDisklet.delete('walletCache.json')
    }
    await account.logout()

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    // Cold wallets cannot emit until their startup work runs,
    // so they bypass the queue: every creation begins even though
    // the single queue slot never opens:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() => created.length === walletIds.length)

    release()
    await account2.waitForAllWallets()
    await account2.logout()
  })

  it('a wallet deleted while queued gives up its place in line', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(3)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )
    await pollUntil(() => created.length === 1)

    // Delete a wallet that is still waiting in the queue:
    const queued = walletIds.filter(walletId => !created.includes(walletId))
    const deleted = queued[0]
    await account.changeWalletStates({ [deleted]: { deleted: true } })

    // The queue keeps moving: the deleted wallet never creates an
    // engine, and the remaining wallets still get theirs:
    release()
    const survivors = walletIds.filter(walletId => walletId !== deleted)
    await pollUntil(() => created.length === survivors.length)
    expect(sorted(created)).deep.equals(sorted(survivors))
    await snooze(RACE_WAIT_MS)
    expect(created.includes(deleted)).equals(false)
    await account.logout()
  })

  it('admits wallets up to the configured concurrency', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(3)

    engineSchedulerConfig.concurrency = 2
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // With two slots and three wallets, exactly two creations begin:
    await pollUntil(() => created.length === 2)
    await snooze(RACE_WAIT_MS)
    expect(created.length).equals(2)

    release()
    await pollUntil(() => created.length === walletIds.length)
    await account.logout()
  })

  it('an engine-backed method call bumps a queued wallet', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(4)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )
    await pollUntil(() => created.length === 1)

    // makeSpend waits on the engine internally, which bumps the queue:
    const queued = walletIds.filter(walletId => !created.includes(walletId))
    const target = queued[queued.length - 1]
    const spendPromise = account.currencyWallets[target].makeSpend({
      tokenId: null,
      spendTargets: [{ publicAddress: 'somewhere', nativeAmount: '0' }]
    })

    release()
    await pollUntil(() => created.length === walletIds.length)
    expect(created[1]).equals(target)
    await spendPromise
    await account.logout()
  })

  it('a storage-backed method call bumps a queued wallet', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(4)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )
    await pollUntil(() => created.length === 1)

    // The repo loads inside the queued startup work, so a rename
    // pends on it and bumps this wallet to the front:
    const queued = walletIds.filter(walletId => !created.includes(walletId))
    const target = queued[queued.length - 1]
    const renamePromise =
      account.currencyWallets[target].renameWallet('Bumped Name')

    release()
    await pollUntil(() => created.length === walletIds.length)
    expect(created[1]).equals(target)
    await renamePromise
    expect(account.currencyWallets[target].name).equals('Bumped Name')
    await account.logout()
  })

  it('changePaused(false) bumps a queued wallet', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(4)

    engineSchedulerConfig.concurrency = 1
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = walletId => created.push(walletId)
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await pollUntil(() =>
      walletIds.every(walletId => account.currencyWallets[walletId] != null)
    )
    await pollUntil(() => created.length === 1)

    const queued = walletIds.filter(walletId => !created.includes(walletId))
    const target = queued[queued.length - 1]
    await account.currencyWallets[target].changePaused(false)

    release()
    await pollUntil(() => created.length === walletIds.length)
    expect(created[1]).equals(target)
    await account.logout()
  })

  it('a bump before the wallet reaches the queue still counts', async function () {
    engineSchedulerConfig.concurrency = 1
    const scheduler = getEngineScheduler({})

    const releaseFirst = await scheduler.acquire('first')

    // Ask for a wallet that has not reached the queue yet:
    scheduler.bump('wanted')

    const order: string[] = []
    const otherPromise = scheduler.acquire('other').then(release => {
      order.push('other')
      return release
    })
    const wantedPromise = scheduler.acquire('wanted').then(release => {
      order.push('wanted')
      return release
    })

    // "other" queued first, but the sticky bump front-loads "wanted":
    releaseFirst()
    const releaseWanted = await wantedPromise
    expect(order).deep.equals(['wanted'])
    releaseWanted()
    const releaseOther = await otherPromise
    expect(order).deep.equals(['wanted', 'other'])
    releaseOther()
  })

  it('the watchdog frees a slot held too long', async function () {
    engineSchedulerConfig.concurrency = 1
    engineSchedulerConfig.slotTimeoutMs = 50
    const scheduler = getEngineScheduler({})

    let timedOut = false
    await scheduler.acquire('wedged', () => {
      timedOut = true
    })

    // Never release "wedged"; the watchdog frees the slot anyway:
    const release = await scheduler.acquire('next')
    expect(timedOut).equals(true)
    release()
  })

  it('unchanged balances keep the same balanceMap object', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeMultiWalletWorld(1)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletIds[0])
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 20 })
    await pollUntil(() => wallet.balanceMap.get(null) === '20')

    // Re-reporting the same balance must not produce a new map:
    const before = wallet.balanceMap
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 20 })
    await snooze(RACE_WAIT_MS)
    expect(wallet.balanceMap).equals(before)

    // A real change still lands:
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 21 })
    await pollUntil(() => wallet.balanceMap.get(null) === '21')
    expect(wallet.balanceMap).not.equals(before)
    await account.logout()
  })
})

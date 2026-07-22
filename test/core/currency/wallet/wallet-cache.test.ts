import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'

import { walletCacheSaverConfig } from '../../../../src/core/currency/wallet/wallet-cache-file'
import {
  EdgeContext,
  EdgeCurrencyWallet,
  makeFakeEdgeWorld
} from '../../../../src/index'
import { snooze } from '../../../../src/util/snooze'
import { expectRejection } from '../../../expect-rejection'
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

interface CachedWorld {
  context: EdgeContext
  walletId: string
}

/**
 * Logs in once without any engine gate, decorates the fakecoin wallet
 * with recognizable values, waits for the cache saver to persist them,
 * and logs out. The returned context has a warm cache on disk.
 */
async function makeCachedWorld(): Promise<CachedWorld> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { fakecoin: true }
  })

  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)

  await wallet.renameWallet('Cached Name')
  await wallet.changeEnabledTokenIds(['badf00d5'])
  await account.currencyConfig.fakecoin.changeUserSettings({
    balance: 12345,
    tokenBalance: 45
  })

  // Let the callbacks propagate and the throttled saver write:
  await snooze(SAVE_WAIT_MS)
  await account.logout()

  return { context, walletId: walletInfo.id }
}

describe('wallet cache', function () {
  beforeEach(function () {
    fakePluginTestConfig.currencyInfoPatch = undefined
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.omitEngineOtherMethods = undefined
    walletCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.currencyInfoPatch = undefined
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.omitEngineOtherMethods = undefined
    walletCacheSaverConfig.throttleMs = 5000
  })

  it('cold login without cache files matches master behavior', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First-ever login on this device, with engine creation blocked:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('Broken test account')

    // With no cache, the wallet must not emit while the engine is blocked:
    await snooze(RACE_WAIT_MS)
    expect(account.currencyWallets[walletInfo.id]).equals(undefined)

    // Releasing the engine lets the wallet finish loading as on master:
    release()
    const wallet = await account.waitForCurrencyWallet(walletInfo.id)
    expect(wallet.name).equals('Fake Wallet')
    await account.logout()
  })

  it('warm login emits cached wallet before the engine exists', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // The wallet emits from the cache while the engine is still blocked:
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.name).equals('Cached Name')
    expect(wallet.fiatCurrencyCode).equals('iso:USD')
    expect(wallet.enabledTokenIds).deep.equals(['badf00d5'])
    expect(wallet.balanceMap.get(null)).equals('12345')
    expect(wallet.balances.FAKE).equals('12345')
    expect(wallet.balances.TOKEN).equals('45')

    release()
    await account.logout()
  })

  it('live engine data overwrites cached values on the same object', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.balances.FAKE).equals('12345')

    release()
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 777 })
    await snooze(SAVE_WAIT_MS)

    // Live data lands on the very same wallet object:
    expect(wallet.balances.FAKE).equals('777')
    expect(account.currencyWallets[walletId]).equals(wallet)
    await account.logout()
  })

  it('makeSpend pends during the cache window and then completes', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    let settled = false
    const spendPromise = wallet
      .makeSpend({
        tokenId: null,
        spendTargets: [{ publicAddress: 'somewhere', nativeAmount: '0' }]
      })
      .then(tx => {
        settled = true
        return tx
      })

    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)

    release()
    const tx = await spendPromise
    expect(tx.txid).equals('spend')
    await account.logout()
  })

  it('engine failure rejects calls pending on the engine', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, fail } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    const spendPromise = wallet.makeSpend({
      tokenId: null,
      spendTargets: [{ publicAddress: 'somewhere', nativeAmount: '0' }]
    })

    fail(new Error('Engine exploded'))
    await expectRejection(spendPromise, 'Error: Engine exploded')
    await account.logout()
  })

  it('storage-backed methods survive an engine failure', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, fail } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    fail(new Error('Engine exploded'))

    // Engine-backed methods reject, but the repo is healthy,
    // so storage-backed methods keep working:
    await expectRejection(
      wallet.makeSpend({
        tokenId: null,
        spendTargets: [{ publicAddress: 'somewhere', nativeAmount: '0' }]
      }),
      'Error: Engine exploded'
    )
    await wallet.renameWallet('Renamed After Failure')
    expect(wallet.name).equals('Renamed After Failure')
    await account.logout()
  })

  it('deleting the wallet rejects calls pending on the engine', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    const spendPromise = wallet.makeSpend({
      tokenId: null,
      spendTargets: [{ publicAddress: 'somewhere', nativeAmount: '0' }]
    })

    await account.changeWalletStates({ [walletId]: { deleted: true } })

    // The pixie tree tears down, so the pending call must reject,
    // not dangle forever:
    await expectRejection(spendPromise)
    release()
    await account.logout()
  })

  it('renameWallet during the cache window updates Redux and the cache file', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    // The repo loads before the engine, so renames work in the window:
    await wallet.renameWallet('Renamed In Window')
    expect(wallet.name).equals('Renamed In Window')

    // The saver picks up the change:
    await snooze(SAVE_WAIT_MS)
    release()
    await account.logout()

    // The next gated login sees the new name from the cache:
    const { gate: gate2, release: release2 } = createEngineGate()
    fakePluginTestConfig.engineGate = gate2
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Renamed In Window')
    release2()
    await account2.logout()
  })

  it('logout during a pending throttled save cancels the write', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Slow the saver down so its write is still pending at logout:
    walletCacheSaverConfig.throttleMs = 3000
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.renameWallet('Ghost Name')
    await account.logout()

    // The cancelled write must not have touched the cache:
    walletCacheSaverConfig.throttleMs = 50
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Cached Name')
    release()
    await account2.logout()
  })

  it('rejects a corrupt cache file, falls back cold, and re-saves', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Corrupt the cache file after the saver has settled:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)
    await wallet.localDisklet.setText('walletCache.json', '{ "version": 99 }')
    await account.logout()

    // A corrupt file means the cold path runs:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await snooze(RACE_WAIT_MS)
    expect(account2.currencyWallets[walletId]).equals(undefined)

    // Releasing the engine loads the wallet, and the saver rewrites the file:
    release()
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Cached Name')
    await snooze(SAVE_WAIT_MS)
    await account2.logout()

    // The rewritten file feeds the next gated login:
    const { gate: gate3, release: release3 } = createEngineGate()
    fakePluginTestConfig.engineGate = gate3
    const account3 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet3 = await account3.waitForCurrencyWallet(walletId)
    expect(wallet3.name).equals('Cached Name')
    release3()
    await account3.logout()
  })

  it('balance changes reach the cache file within a throttle window', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 999 })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.balances.FAKE).equals('999')
    release()
    await account2.logout()
  })

  it('classifies every wallet property as cache-seeded or engine-gated', async function () {
    this.timeout(15000)

    // Everything the wallet-list scene renders pre-engine must come
    // from the cache file. If this list changes, walletCache.json
    // (and its saver and seed paths) must change with it:
    const cacheSeeded = [
      'balanceMap',
      'balances',
      'enabledTokenIds',
      'fiatCurrencyCode',
      'name'
    ]

    // The documented engine-gated set from the design's section 5.4:
    // methods that internally await the engine, plus engine-sourced
    // getters with safe pre-engine defaults:
    const engineGated = [
      '$internalStreamTransactions',
      'accelerate',
      'blockHeight',
      'broadcastTx',
      'detectedTokenIds',
      'dumpData',
      'getMaxSpendable',
      'getNumTransactions',
      'getPaymentProtocolInfo',
      'getTransactions',
      'lockReceiveAddress',
      'makeSpend',
      'resyncBlockchain',
      'saveReceiveAddress',
      'saveTx',
      'saveTxAction',
      'saveTxMetadata',
      'signBytes',
      'signMessage',
      'signTx',
      'split',
      'stakingStatus',
      'streamTransactions',
      'sweepPrivateKeys',
      'syncRatio',
      'syncStatus',
      'unactivatedTokenIds'
    ]

    // Cache-assisted surfaces: engine-gated by default, but served
    // from the cache pre-engine when it can answer (addresses only on
    // stable-address chains; otherMethods stubs from cached names):
    const cacheAssisted = ['getAddresses', 'getReceiveAddress', 'otherMethods']

    // Identity, storage-backed, config, and tools surfaces, which
    // never needed an engine in the first place:
    const engineFree = [
      'changeEnabledTokenIds',
      'changePaused',
      'changeWalletSettings',
      'created',
      'currencyConfig',
      'currencyInfo',
      'denominationToNative',
      'disklet',
      'encodeUri',
      'id',
      'imported',
      'localDisklet',
      'nativeToDenomination',
      'on',
      'parseUri',
      'paused',
      'publicWalletInfo',
      'renameWallet',
      'setFiatCurrencyCode',
      'sync',
      'type',
      'walletSettings',
      'watch'
    ]

    const { context, walletId } = await makeCachedWorld()
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    // Every property on the live wallet object must be classified.
    // A newly added EdgeCurrencyWallet property fails here until
    // someone decides whether the cache must seed it:
    const classified = new Set([
      ...cacheSeeded,
      ...cacheAssisted,
      ...engineGated,
      ...engineFree
    ])
    const unclassified = Object.getOwnPropertyNames(wallet).filter(
      // The yaob bridge adds its own bookkeeping property:
      key => key !== '_yaob' && !classified.has(key)
    )
    expect(unclassified).deep.equals([])

    // And the classification must not name properties that no longer
    // exist, so removals also force a decision:
    const surface = new Set(Object.getOwnPropertyNames(wallet))
    const stale = [...classified].filter(key => !surface.has(key))
    expect(stale).deep.equals([])

    // The cache-seeded properties actually carry cached values while
    // the engine is still blocked:
    expect(wallet.name).equals('Cached Name')
    expect(wallet.fiatCurrencyCode).equals('iso:USD')
    expect(wallet.enabledTokenIds).deep.equals(['badf00d5'])
    expect(wallet.balanceMap.get(null)).equals('12345')
    expect(wallet.balances.FAKE).equals('12345')

    release()
    await account.logout()
  })

  it('serves cached addresses pre-engine on a stable-address chain', async function () {
    this.timeout(15000)
    fakePluginTestConfig.currencyInfoPatch = { hasStableAddresses: true }
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache: query once with the engine running,
    // then let the throttled saver persist the answer:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    const live = await wallet.getAddresses({ tokenId: null })
    expect(live[0].publicAddress).equals('fakesegwit')
    await snooze(SAVE_WAIT_MS)

    // The engine's answer reached the cache file, balances stripped:
    const text = await wallet.localDisklet.getText('walletCache.json')
    expect(text.includes('fakeaddress')).equals(true)
    expect(text.includes('nativeBalance')).equals(false)
    await account.logout()

    // A warm login serves the cached addresses while the engine is
    // still blocked, and getReceiveAddress derives from them:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    const cached = await wallet2.getAddresses({ tokenId: null })
    expect(cached.map(address => address.publicAddress)).deep.equals(
      live.map(address => address.publicAddress)
    )
    const receive = await wallet2.getReceiveAddress({ tokenId: null })
    expect(receive.publicAddress).equals('fakeaddress')
    release()
    await account2.logout()
  })

  it('keeps the engine gate for rotating-address chains', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache, exactly as on the stable chain:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // Without the stability hint, a warm-login address query still
    // waits for the engine, exactly the pre-cache behavior:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    let settled = false
    const addressPromise = wallet2
      .getAddresses({ tokenId: null })
      .then(addresses => {
        settled = true
        return addresses
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)
    release()
    const addresses = await addressPromise
    expect(addresses[0].publicAddress).equals('fakesegwit')
    await account2.logout()
  })

  it('calls a cached otherMethods name before the engine exists', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // The engine's method names are in the cache, so a warm login
    // exposes a delegating stub pre-engine. Calling it pends on the
    // engine and then forwards:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.otherMethods.testMethod).not.equals(undefined)
    let settled = false
    const callPromise = wallet.otherMethods
      .testMethod('early')
      .then((result: string) => {
        settled = true
        return result
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)
    release()
    expect(await callPromise).equals('testMethod called with: early')
    await account.logout()
  })

  it('rejects a stale cached method name the engine lacks', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // The next session's engines are built WITHOUT otherMethods, so
    // the cached `testMethod` name is stale. The stub still exists,
    // and rejects cleanly once the engine loads without the method:
    fakePluginTestConfig.omitEngineOtherMethods = true
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.otherMethods.testMethod).not.equals(undefined)
    await expectRejection(
      wallet.otherMethods.testMethod('stale'),
      'Error: The wallet engine does not implement "testMethod"'
    )
    await account.logout()
  })

  it('otherMethods is {} pre-engine and carries engine methods post-engine', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)

    // Pre-engine, otherMethods is a safe empty object:
    expect(wallet.otherMethods).not.equals(undefined)
    expect(Object.keys(wallet.otherMethods)).deep.equals([])

    release()
    await waitForOtherMethods(wallet)
    expect(await wallet.otherMethods.testMethod('hello')).equals(
      'testMethod called with: hello'
    )
    await account.logout()
  })
})

/** Polls until the engine's otherMethods replace the empty pre-engine ones. */
async function waitForOtherMethods(wallet: EdgeCurrencyWallet): Promise<void> {
  for (let i = 0; i < 100; ++i) {
    if (wallet.otherMethods.testMethod != null) return
    await snooze(50)
  }
  throw new Error('otherMethods never arrived')
}

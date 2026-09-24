import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'

import { accountCacheSaverConfig } from '../../../../src/core/account/account-cache-saver'
import { walletCacheLoaderHooks } from '../../../../src/core/currency/wallet/wallet-cache-loader'
import { fakeWorldTestConfig } from '../../../../src/core/fake/fake-world'
import {
  EdgeContext,
  EdgeCurrencyEngineCallbacks,
  EdgeCurrencyWallet,
  EdgeFakeWorld,
  EdgeStakingStatus,
  makeFakeEdgeWorld
} from '../../../../src/index'
import { snooze } from '../../../../src/util/snooze'
import { expectRejection } from '../../../expect-rejection'
import {
  createEngineGate,
  fakePluginTestConfig
} from '../../../fake/fake-currency-plugin'
import { fakeUser } from '../../../fake/fake-user'
import {
  findTestDatabase,
  readAccountCache
} from '../../../fake/wallet-cache-rows'

const contextOptions = { apiKey: '', appId: '', deviceDescription: 'iphone12' }
const quiet = { onLog() {} }

// Generous wait for the throttled cache saver (50ms in tests) to write:
const SAVE_WAIT_MS = 300

// Short wait to prove something has *not* happened:
const RACE_WAIT_MS = 150

interface CachedWorld {
  context: EdgeContext
  walletId: string
  world: EdgeFakeWorld
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
  await wallet.setFiatCurrencyCode('iso:USD')
  await wallet.changeEnabledTokenIds(['badf00d5'])
  await account.currencyConfig.fakecoin.changeUserSettings({
    balance: 12345,
    tokenBalance: 45
  })

  // Let the callbacks propagate and the throttled saver write:
  await snooze(SAVE_WAIT_MS)
  await account.logout()

  return { context, walletId: walletInfo.id, world }
}

describe('wallet cache', function () {
  beforeEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.freshAddressPatch = undefined
    fakePluginTestConfig.omitEngineOtherMethods = undefined
    fakePluginTestConfig.onEngineKill = undefined
    fakePluginTestConfig.onEngineCreate = undefined
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.publicKeyCheckGate = undefined
    fakePluginTestConfig.legacyTokenPlugin = undefined
    fakePluginTestConfig.failEngineFor = undefined
    fakePluginTestConfig.onEngineCallbacks = undefined
    fakePluginTestConfig.stakingStatusHook = undefined
    fakeWorldTestConfig.readGate = undefined
    walletCacheLoaderHooks.fallbackSeedGate = undefined
    walletCacheLoaderHooks.onFallbackSeed = undefined
    accountCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.freshAddressPatch = undefined
    fakePluginTestConfig.omitEngineOtherMethods = undefined
    fakePluginTestConfig.onEngineKill = undefined
    fakePluginTestConfig.onEngineCreate = undefined
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.publicKeyCheckGate = undefined
    fakePluginTestConfig.legacyTokenPlugin = undefined
    fakePluginTestConfig.failEngineFor = undefined
    fakePluginTestConfig.onEngineCallbacks = undefined
    fakePluginTestConfig.stakingStatusHook = undefined
    fakeWorldTestConfig.readGate = undefined
    walletCacheLoaderHooks.fallbackSeedGate = undefined
    walletCacheLoaderHooks.onFallbackSeed = undefined
    accountCacheSaverConfig.throttleMs = 5000
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

  it('an engine that finishes creating after deletion is killed', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Hold engine creation open so the wallet can be deleted while
    // `makeCurrencyEngine` is still in flight:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const killed: string[] = []
    fakePluginTestConfig.onEngineKill = id => killed.push(id)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await account.changeWalletStates({ [walletId]: { deleted: true } })

    // `engineStarted`'s destroy has already run with no engine to
    // kill, so the startup block itself has to clean this one up:
    release()
    await snooze(250)
    expect(killed).deep.equals([walletId])
    expect(account.currencyWallets[walletId]).equals(undefined)

    await account.logout()
  })

  it('logout during engine startup does not error on account state', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Park the startup block inside `getPublicWalletInfo`, which sits
    // after the account API has emitted and before the block reads the
    // account's tokens and settings:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.publicKeyCheckGate = gate

    const errors: unknown[] = []
    const unsubscribe = context.on('error', error => errors.push(error))

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)

    // Log out while the block is parked, so the account is gone from
    // Redux by the time it resumes and reaches for its settings:
    await account.logout()
    release()
    await snooze(250)

    unsubscribe()
    expect(errors).deep.equals([])
  })

  it('logout during engine startup swallows a late startup failure', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Park the startup block inside engine creation, log out, and
    // then fail the creation: the wallet is gone, so the failure is
    // teardown and must not surface as an error:
    const { gate, fail } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const errors: unknown[] = []
    const unsubscribe = context.on('error', error => errors.push(error))

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await account.logout()
    fail(new Error('Engine exploded after logout'))
    await snooze(250)

    unsubscribe()
    expect(errors).deep.equals([])
  })

  it('holds engine startup until the deferred account load lands', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Hold the deferred account load open. The wallet still emits from
    // cache, but its engine must not be built against account state
    // that has not loaded: an engine created with empty `userSettings`
    // opens connections before a privacy setting can apply.
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const created: string[] = []
    fakePluginTestConfig.onEngineCreate = id => created.push(id)

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.name).equals('Cached Name')

    await snooze(RACE_WAIT_MS)
    expect(created).deep.equals([])

    release()
    await snooze(SAVE_WAIT_MS)
    expect(created).contains(walletId)

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
    accountCacheSaverConfig.throttleMs = 3000
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.renameWallet('Ghost Name')
    await account.logout()

    // The cancelled write must not have touched the cache:
    accountCacheSaverConfig.throttleMs = 50
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Cached Name')
    release()
    await account2.logout()
  })

  it('caches a token toggle made before the token file loads', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Park the startup block before its file loads, toggle a token
    // on the cache-seeded wallet, and let the saver write once:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.publicKeyCheckGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.changeEnabledTokenIds([])
    await snooze(SAVE_WAIT_MS)

    // The load lands and merges to the same list. That is a new write
    // for the cache, which carried the pre-toggle entry until now:
    release()
    await snooze(SAVE_WAIT_MS)
    const cache = await readAccountCache(account)
    expect(cache.wallets[walletId].enabledTokenIds).deep.equals([])
    await account.logout()
  })

  it('keeps the cache entry of a wallet whose files have not loaded', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Park this wallet's startup before its file loads, so the saver
    // skips it on every write of this session; the other wallet's
    // loads still land and trigger writes:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.publicKeyCheckGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.name).equals('Cached Name')
    await snooze(SAVE_WAIT_MS)

    // A skipped wallet keeps the entry it already had, even though it
    // has no explicit entry in `walletStates`:
    const cache = await readAccountCache(account)
    expect(cache.wallets[walletId]?.name).equals('Cached Name')
    release()
    await account.logout()
  })

  it('keeps writing a wallet to the cache after a resync', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)

    // A resync clears the engine state, including `tokenFileLoaded`,
    // but the wallet's enabled list and files are still loaded. A
    // change made afterwards must still reach the cache:
    await wallet.resyncBlockchain()
    await wallet.renameWallet('After Resync')
    await snooze(SAVE_WAIT_MS)
    const cache = await readAccountCache(account)
    expect(cache.wallets[walletId].name).equals('After Resync')
    await account.logout()
  })

  it('keeps the cached token list when no token file is readable', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Break both token files, so the next startup reads neither:
    const accountA = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletA = await accountA.waitForCurrencyWallet(walletId)
    await walletA.disklet.setText('Tokens.json', 'not json')
    await walletA.disklet.setText('EnabledTokens.json', 'not json')
    await accountA.logout()

    // The cache still names the token, and an unreadable file is no
    // reason to drop it from the wallet or from the next cache write:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.enabledTokenIds).deep.equals(['badf00d5'])
    await wallet.renameWallet('After Load')
    await snooze(SAVE_WAIT_MS)
    expect(wallet.enabledTokenIds).deep.equals(['badf00d5'])
    const cache = await readAccountCache(account)
    expect(cache.wallets[walletId].name).equals('After Load')
    expect(cache.wallets[walletId].enabledTokenIds).deep.equals(['badf00d5'])
    await account.logout()
  })

  it('adds a legacy-plugin token while the engines are still queued', async function () {
    this.timeout(15000)
    const { context } = await makeCachedWorld()

    // A legacy plugin validates tokens through a running engine. On a
    // warm login the wallets exist before their engines, so the add
    // must wait for one instead of failing:
    fakePluginTestConfig.legacyTokenPlugin = true
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()

    let settled = false
    const pending = account.currencyConfig.fakecoin.addCustomToken({
      currencyCode: 'LEGACY',
      displayName: 'Legacy Token',
      denominations: [{ multiplier: '100', name: 'LEGACY' }],
      networkLocation: { contractAddress: '0x1e6ac7' }
    })
    pending.then(
      () => (settled = true),
      () => (settled = true)
    )
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)

    release()
    expect(await pending).equals('1e6ac7')
    await account.logout()
  })

  it('a legacy-plugin token add skips a failed wallet for a queued one', async function () {
    this.timeout(15000)
    const { context } = await makeCachedWorld()

    // The wait used to pick the plugin's first wallet. Learn which one
    // that is, then fail its engine while the other wallet stays
    // queued behind the gate:
    const probe = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const [firstId] = probe.activeWalletIds
    await probe.logout()

    fakePluginTestConfig.legacyTokenPlugin = true
    fakePluginTestConfig.failEngineFor = firstId
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForAllWallets()
    await snooze(RACE_WAIT_MS)

    let settled = false
    const pending = account.currencyConfig.fakecoin.addCustomToken({
      currencyCode: 'LEGACY',
      displayName: 'Legacy Token',
      denominations: [{ multiplier: '100', name: 'LEGACY' }],
      networkLocation: { contractAddress: '0x1e6ac7' }
    })
    pending.then(
      () => (settled = true),
      () => (settled = true)
    )
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)

    release()
    expect(await pending).equals('1e6ac7')
    await account.logout()
  })

  it('a fallback read that outlives its logout does not seed the next session', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // A wallet created after boot and archived seeds through the
    // fallback read when it comes back. Park session A's pixie on the
    // seed it read, and log out with it parked:
    const accountA = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await accountA.waitForCurrencyWallet(walletId)
    const created = await accountA.createCurrencyWallet('wallet:fakecoin', {
      fiatCurrencyCode: 'iso:USD',
      name: 'Session A Name'
    })
    await snooze(SAVE_WAIT_MS)
    await accountA.changeWalletStates({ [created.id]: { archived: true } })
    await snooze(RACE_WAIT_MS)
    const seeded: string[] = []
    walletCacheLoaderHooks.onFallbackSeed = id => seeded.push(id)
    const { gate, release } = createEngineGate()
    walletCacheLoaderHooks.fallbackSeedGate = gate
    await accountA.changeWalletStates({ [created.id]: { archived: false } })
    await snooze(RACE_WAIT_MS)
    walletCacheLoaderHooks.fallbackSeedGate = undefined
    expect(seeded).deep.equals([])
    await accountA.logout()

    // Session B boots the wallet from the bulk seed and renames it.
    // Session A's read then resumes into a destroyed pixie:
    const accountB = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletB = await accountB.waitForCurrencyWallet(created.id)
    await walletB.renameWallet('Session B Name')
    release()
    await snooze(RACE_WAIT_MS)
    expect(walletB.name).equals('Session B Name')
    expect(seeded).deep.equals([])
    await accountB.logout()
  })

  it('startup loads that outlive a logout do not touch the next session', async function () {
    this.timeout(15000)
    const { context, walletId, world } = await makeCachedWorld()

    // Session A boots from cache with its engine held, then parks its
    // fiat-file load on the value it already read, and logs out:
    const engine = createEngineGate()
    fakePluginTestConfig.engineGate = engine.gate
    const accountA = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletA = await accountA.waitForCurrencyWallet(walletId)
    expect(walletA.fiatCurrencyCode).equals('iso:USD')
    const disk = createEngineGate()
    fakeWorldTestConfig.readGate = disk.gate
    engine.release()
    await snooze(RACE_WAIT_MS)
    fakeWorldTestConfig.readGate = undefined
    fakePluginTestConfig.engineGate = undefined
    await accountA.logout()

    // Another device changes the fiat code and pushes it:
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })
    const accountB = await contextB.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const walletB = await accountB.waitForCurrencyWallet(walletId)
    await walletB.setFiatCurrencyCode('iso:EUR')
    await walletB.sync()
    await accountB.logout()

    // The next session on this device pulls that change. Session A's
    // parked load then resumes with the code it read before, under the
    // same wallet id, and must not apply to this session:
    const accountC = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletC = await accountC.waitForCurrencyWallet(walletId)
    await walletC.sync()
    for (let i = 0; i < 20 && walletC.fiatCurrencyCode !== 'iso:EUR'; ++i) {
      await snooze(RACE_WAIT_MS)
    }
    expect(walletC.fiatCurrencyCode).equals('iso:EUR')
    disk.release()
    await snooze(RACE_WAIT_MS)
    expect(walletC.fiatCurrencyCode).equals('iso:EUR')
    await accountC.logout()
  })

  it('a wallet created after boot seeds from the cache when unarchived', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Boot warm, then create a wallet the booted file never carried
    // and let the saver write it into the next generation:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    const created = await account.createCurrencyWallet('wallet:fakecoin', {
      fiatCurrencyCode: 'iso:USD',
      name: 'Born After Boot'
    })
    await snooze(SAVE_WAIT_MS)
    await account.changeWalletStates({ [created.id]: { archived: true } })
    await snooze(RACE_WAIT_MS)

    // Unarchiving it with the engine held back has to emit the wallet
    // from its cache entry, the same as a wallet the boot seeded:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    await account.changeWalletStates({ [created.id]: { archived: false } })
    await snooze(RACE_WAIT_MS)
    expect(account.currencyWallets[created.id]?.name).equals('Born After Boot')

    release()
    await account.logout()
  })

  it('boots a wallet whose row no longer reads cold, and re-saves it', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Break the wallet's row after the saver has settled. Well-formed
    // JSON of the wrong shape, which only the read-side cleaner can
    // refuse:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)
    accountCacheSaverConfig.throttleMs = 5000
    const { driver } = await findTestDatabase(account)
    await driver.exec([
      {
        sql: 'UPDATE wallet SET wallet_info = ? WHERE wallet_id = ?',
        params: ['{"not":"a wallet info"}', walletId]
      }
    ])
    await account.logout()
    accountCacheSaverConfig.throttleMs = 50

    // A row that does not read means this wallet's cold path runs:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await snooze(RACE_WAIT_MS)
    expect(account2.currencyWallets[walletId]).equals(undefined)

    // Releasing the engine loads the wallet, and the saver rewrites the row:
    release()
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Cached Name')
    await snooze(SAVE_WAIT_MS)
    await account2.logout()

    // The rewritten row feeds the next gated login:
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
    // from the cache pre-engine when it can answer (cached addresses;
    // otherMethods stubs from cached names):
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

  it('serves cached addresses pre-engine', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache: query once with the engine running,
    // then let the throttled saver persist the answer:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    const live = await wallet.getAddresses({ tokenId: null })
    expect(live[0].publicAddress).equals('fakesegwit')
    await snooze(SAVE_WAIT_MS)

    // The engine's answer reached the cache file, balances stripped:
    const cache = await readAccountCache(account)
    const stored = cache.wallets[walletId]
    expect(JSON.stringify(stored.addresses).includes('fakeaddress')).equals(
      true
    )
    expect(JSON.stringify(stored).includes('nativeBalance')).equals(false)
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

  it('a logout while a cached-address reconcile waits reports no error', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache, so the next login can serve it:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // Warm login with the engine held: the query is answered from the
    // cache, and its background reconcile parks on the engine wait:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const errors: unknown[] = []
    const unsubscribe = context.on('error', error => errors.push(error))

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    await wallet2.getAddresses({ tokenId: null })

    // The logout rejects that parked wait. The correction is moot once
    // the wallet is gone, so nothing reaches the app's error handler:
    await account2.logout()
    release()
    fakePluginTestConfig.engineGate = undefined
    await snooze(250)

    unsubscribe()
    expect(errors).deep.equals([])
  })

  it('emits addressChanged when the engine disagrees with the cache', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache with this engine's answer:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    const primed = await wallet.getAddresses({ tokenId: null })
    expect(primed[0].publicAddress).equals('fakesegwit')
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // The next session's engine derives a different address, which is
    // what a rotating chain does once the cached one has been used:
    fakePluginTestConfig.freshAddressPatch = { segwitAddress: 'rotatedsegwit' }
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)

    let changed = 0
    wallet2.on('addressChanged', () => {
      ++changed
    })

    // The pre-engine query is served from the cache, silently:
    const cached = await wallet2.getAddresses({ tokenId: null })
    expect(cached[0].publicAddress).equals('fakesegwit')
    expect(changed).equals(0)

    // Once the engine loads it disagrees, so the wallet tells its
    // consumers to re-query, and the re-query returns the new address:
    release()
    await snooze(SAVE_WAIT_MS)
    expect(changed).equals(1)
    const confirmed = await wallet2.getAddresses({ tokenId: null })
    expect(confirmed[0].publicAddress).equals('rotatedsegwit')
    await account2.logout()
  })

  it('emits addressChanged once when several callers share the cache', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    fakePluginTestConfig.freshAddressPatch = { segwitAddress: 'rotatedsegwit' }
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)

    let changed = 0
    wallet2.on('addressChanged', () => {
      ++changed
    })

    // Several consumers can be served the same cached answer before
    // the engine lands (the receive scene alone asks twice, since
    // getReceiveAddress goes through getAddresses). One engine query
    // settles the correction for all of them:
    const served = await Promise.all([
      wallet2.getAddresses({ tokenId: null }),
      wallet2.getAddresses({ tokenId: null }),
      wallet2.getReceiveAddress({ tokenId: null })
    ])
    expect(served[0][0].publicAddress).equals('fakesegwit')
    expect(changed).equals(0)

    release()
    await snooze(SAVE_WAIT_MS)
    expect(changed).equals(1)
    const confirmed = await wallet2.getAddresses({ tokenId: null })
    expect(confirmed[0].publicAddress).equals('rotatedsegwit')
    await account2.logout()
  })

  it('stops serving the cached address once the engine fails', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // A warm cache must not make a wallet whose engine died look
    // healthy: the engine is never coming, so the query has to reject
    // rather than serve the cache forever:
    const { gate, fail } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(
      (await wallet2.getAddresses({ tokenId: null }))[0].publicAddress
    ).equals('fakesegwit')

    fail(new Error('Engine exploded'))
    await expectRejection(
      wallet2.getAddresses({ tokenId: null }),
      'Error: Engine exploded'
    )
    await account2.logout()
  })

  it('stays quiet when the engine confirms the cached address', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // This engine derives exactly what the cache holds, the common
    // case, so the reconcile must not wake every consumer up:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)

    let changed = 0
    wallet2.on('addressChanged', () => {
      ++changed
    })

    expect(
      (await wallet2.getAddresses({ tokenId: null }))[0].publicAddress
    ).equals('fakesegwit')
    release()
    await snooze(SAVE_WAIT_MS)
    expect(changed).equals(0)
    await account2.logout()
  })

  it('keeps the engine gate when forceIndex is set', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Prime the address cache:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await wallet.getAddresses({ tokenId: null })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // The plain query is served from the cache, but a caller naming a
    // specific index wants a freshly derived address, which only the
    // engine can produce, so that query still waits:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    const cached = await wallet2.getAddresses({ tokenId: null })
    expect(cached[0].publicAddress).equals('fakesegwit')

    let settled = false
    const forcedPromise = wallet2
      .getAddresses({ tokenId: null, forceIndex: 0 })
      .then(addresses => {
        settled = true
        return addresses
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)
    release()
    const forced = await forcedPromise
    expect(forced[0].publicAddress).equals('fakesegwit')
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
    // Hold the engine, so the stub is observed from the cache rather than
    // raced against an engine that reports no methods at all:
    fakePluginTestConfig.omitEngineOtherMethods = true
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    expect(wallet.otherMethods.testMethod).not.equals(undefined)
    release()
    await expectRejection(
      wallet.otherMethods.testMethod('stale'),
      'Error: The wallet engine does not implement "testMethod"'
    )
    await account.logout()
  })

  it('a cached wallet with no method names grows its stubs post-engine', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // A row cached before the engine ever reported its methods:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)
    accountCacheSaverConfig.throttleMs = 5000
    const { driver } = await findTestDatabase(account)
    await driver.exec([
      {
        sql: `UPDATE wallet SET other_method_names = '[]' WHERE wallet_id = ?`,
        params: [walletId]
      }
    ])
    await account.logout()
    accountCacheSaverConfig.throttleMs = 50

    // It still warm-boots, with no method names yet:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    expect(wallet2.name).equals('Cached Name')
    expect(wallet2.otherMethods.testMethod).equals(undefined)

    // Once the engine lands, its methods appear and work, even
    // through a bridge that saw the empty object first:
    release()
    await waitForOtherMethods(wallet2)
    expect(await wallet2.otherMethods.testMethod('grown')).equals(
      'testMethod called with: grown'
    )

    // ...and the saver records them, so the next boot has them:
    await snooze(SAVE_WAIT_MS)
    const saved = await readAccountCache(account2)
    expect(saved.wallets[walletId].otherMethodNames).includes('testMethod')
    await account2.logout()
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

  it('an engine callback after logout leaves the next session alone', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Keep the callbacks the first session's engine was handed:
    let stale: EdgeCurrencyEngineCallbacks | undefined
    fakePluginTestConfig.onEngineCallbacks = (id, callbacks) => {
      if (id === walletId && stale == null) stale = callbacks
    }

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)
    expect(wallet.balanceMap.get(null)).equals('12345')
    await account.logout()

    // The next login runs a fresh pixie under the same wallet id:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletId)
    if (stale == null) throw new Error('No engine callbacks captured')

    // The dead session's engine reports one last balance. It belongs
    // to nobody, so it must not land on this session's wallet:
    stale.onTokenBalanceChanged(null, '999')
    await snooze(RACE_WAIT_MS)
    expect(wallet2.balanceMap.get(null)).equals('12345')
    await account2.logout()
  })

  it('a staking query that outlives its logout reports no error', async function () {
    this.timeout(15000)
    const { context, walletId } = await makeCachedWorld()

    // Park the staking query the engine startup awaits:
    let called = false
    let failStaking: (error: Error) => void = () => {}
    fakePluginTestConfig.stakingStatusHook = async () => {
      called = true
      return await new Promise<EdgeStakingStatus>((resolve, reject) => {
        failStaking = reject
      })
    }

    const errors: unknown[] = []
    const unsubscribe = context.on('error', error => errors.push(error))

    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.waitForCurrencyWallet(walletId)
    await snooze(SAVE_WAIT_MS)
    expect(called).equals(true)

    // The logout leaves that query pending, and its rejection lands
    // for a wallet the user has already left:
    await account.logout()
    failStaking(new Error('Staking query failed'))
    await snooze(RACE_WAIT_MS)

    unsubscribe()
    expect(errors).deep.equals([])
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

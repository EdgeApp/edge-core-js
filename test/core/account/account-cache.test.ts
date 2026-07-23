import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'
import { base64 } from 'rfc4648'

import { accountCacheSaverConfig } from '../../../src/core/account/account-cache-file'
import { walletCacheSaverConfig } from '../../../src/core/currency/wallet/wallet-cache-file'
import { walletCacheLoaderHooks } from '../../../src/core/currency/wallet/wallet-cache-loader'
import {
  EdgeAccount,
  EdgeContext,
  EdgeFakeWorld,
  makeFakeEdgeWorld
} from '../../../src/index'
import { base58 } from '../../../src/util/encoding'
import { snooze } from '../../../src/util/snooze'
import {
  createEngineGate,
  fakePluginTestConfig
} from '../../fake/fake-currency-plugin'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '', deviceDescription: 'iphone12' }
const quiet = { onLog() {} }

// Generous wait for the throttled cache savers (50ms in tests) to write:
const SAVE_WAIT_MS = 300

// Short wait to prove something has *not* happened:
const RACE_WAIT_MS = 150

interface AccountCachedWorld {
  context: EdgeContext
  /** The world, for making second-device contexts. */
  world: EdgeFakeWorld
  /** Every fakecoin wallet id, in active order at creation time. */
  walletIds: string[]
  /** The custom token added during the first session. */
  customTokenId: string
}

/**
 * Logs in once (a cold start), decorates the account with
 * recognizable values, waits for the account and wallet cache savers
 * to persist them, and logs out. The returned context has a warm
 * account cache on disk, so the next login seeds from it.
 * The fake user starts with two fakecoin wallets; pass `archiveSecond`
 * to archive the second one, so cached wallet states are observable.
 */
async function makeAccountCachedWorld(
  opts: { archiveSecond?: boolean } = {}
): Promise<AccountCachedWorld> {
  const { archiveSecond = false } = opts
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { fakecoin: true }
  })

  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
  const walletIds = [...account.activeWalletIds]
  if (walletIds.length !== 2) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletIds[0])
  await account.waitForCurrencyWallet(walletIds[1])

  await wallet.renameWallet('Cached Name')
  const customTokenId = await account.currencyConfig.fakecoin.addCustomToken({
    currencyCode: 'CACHED',
    displayName: 'Cached Token',
    denominations: [{ multiplier: '100', name: 'CACHED' }],
    networkLocation: { contractAddress: '0xCACHED' }
  })

  // Let both wallets' cache files persist before any archiving,
  // so archived wallets still have a cache to seed from later:
  await snooze(SAVE_WAIT_MS)

  if (archiveSecond) {
    await account.changeWalletStates({ [walletIds[1]]: { archived: true } })
    await snooze(SAVE_WAIT_MS)
  }

  // Push the session's writes to the sync server,
  // so a second device can see them:
  await account.sync()
  await account.logout()

  return { context, world, walletIds, customTokenId }
}

describe('account cache', function () {
  beforeEach(function () {
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.engineGate = undefined
    walletCacheLoaderHooks.onAccountSeed = undefined
    walletCacheLoaderHooks.onBulkSeed = undefined
    walletCacheLoaderHooks.onFallbackSeed = undefined
    accountCacheSaverConfig.throttleMs = 50
    walletCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.engineGate = undefined
    walletCacheLoaderHooks.onAccountSeed = undefined
    walletCacheLoaderHooks.onBulkSeed = undefined
    walletCacheLoaderHooks.onFallbackSeed = undefined
    accountCacheSaverConfig.throttleMs = 5000
    walletCacheSaverConfig.throttleMs = 5000
  })

  it('cold login without an account cache boots as on master', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // A cold boot awaits loadBuiltinTokens before anything else,
    // so a gated first login must not resolve, exactly as on master:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    let settled = false
    const loginPromise = context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(account => {
        settled = true
        return account
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)

    // Releasing the gate lets the whole boot chain finish:
    release()
    const account = await loginPromise
    const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('Broken test account')
    const wallet = await account.waitForCurrencyWallet(walletInfo.id)
    expect(wallet.name).equals('Fake Wallet')

    // The saver persists an account cache for the next login:
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // The next gated login resolves from that cache instead of blocking:
    const { gate: gate2, release: release2 } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate2
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account2.activeWalletIds.length).equals(2)
    release2()
    await account2.logout()
  })

  it('warm login emits the account before the deferred loads land', async function () {
    this.timeout(15000)
    const { context, walletIds, customTokenId } = await makeAccountCachedWorld({
      archiveSecond: true
    })

    // Hold the deferred loads (builtin tokens run at their head),
    // so everything observable here comes from the account cache:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Wallet states seeded: the archived wallet stays out of the list:
    expect([...account.activeWalletIds]).deep.equals([walletIds[0]])
    expect([...account.archivedWalletIds]).deep.equals([walletIds[1]])

    // Custom tokens seeded (the class of data #703's saver lost):
    const { customTokens } = account.currencyConfig.fakecoin
    expect(customTokens[customTokenId]?.currencyCode).equals('CACHED')

    // The wallet emits from its own cache, engine-independent:
    const wallet = await account.waitForCurrencyWallet(walletIds[0])
    expect(wallet.name).equals('Cached Name')

    // Enabling a builtin token in the window pends until the builtin
    // definitions load, instead of silently filtering the id away:
    let tokensSettled = false
    const tokensPromise = wallet
      .changeEnabledTokenIds(['badf00d5'])
      .then(() => {
        tokensSettled = true
      })
    await snooze(RACE_WAIT_MS)
    expect(tokensSettled).equals(false)

    // The deferred loads land and overwrite authoritatively, and the
    // cached token balance gains its currency code once the builtin
    // token definitions arrive:
    release()
    await tokensPromise
    expect([...wallet.enabledTokenIds]).deep.equals(['badf00d5'])
    await pollUntil(
      () =>
        account.currencyConfig.fakecoin.builtinTokens.badf00d5 != null &&
        wallet.balances.TOKEN != null
    )
    await account.logout()
  })

  it('deferred loads overwrite stale cached wallet states', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld()

    // Make the cache disagree with the authoritative files: archive the
    // second wallet, then unarchive it with the account saver slowed
    // down, so the cache still says "archived" while the disk says not:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changeWalletStates({ [walletIds[1]]: { archived: true } })
    await snooze(SAVE_WAIT_MS)
    accountCacheSaverConfig.throttleMs = 5000
    await account.changeWalletStates({ [walletIds[1]]: { archived: false } })
    await account.logout()
    accountCacheSaverConfig.throttleMs = 50

    // The warm login first shows the stale cached state:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account2.activeWalletIds.includes(walletIds[1])).equals(false)

    // ...then corrects once the authoritative load lands:
    release()
    await pollUntil(() => account2.activeWalletIds.includes(walletIds[1]))
    await account2.logout()
  })

  it('warm login seeds every wallet in one bulk dispatch', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld()

    const accountSeeds: string[] = []
    const bulkSeeds: string[][] = []
    const fallbackSeeds: string[] = []
    walletCacheLoaderHooks.onAccountSeed = id => accountSeeds.push(id)
    walletCacheLoaderHooks.onBulkSeed = ids => bulkSeeds.push(ids)
    walletCacheLoaderHooks.onFallbackSeed = id => fallbackSeeds.push(id)

    // Hold the engines, so everything observable is cache-seeded:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Every wallet gate opens from the single bulk tick, pre-engine,
    // and the whole warm login costs exactly two seeding dispatches:
    await pollUntil(() =>
      walletIds.every(id => account.currencyWallets[id] != null)
    )
    expect(accountSeeds.length).equals(1)
    expect(bulkSeeds.length).equals(1)
    expect(sorted(bulkSeeds[0])).deep.equals(sorted(walletIds))
    expect(fallbackSeeds).deep.equals([])
    expect(account.currencyWallets[walletIds[0]].name).equals('Cached Name')

    release()
    await account.logout()
  })

  it('a wallet activated after login seeds through the fallback read', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld({
      archiveSecond: true
    })

    const bulkSeeds: string[][] = []
    const fallbackSeeds: string[] = []
    walletCacheLoaderHooks.onBulkSeed = ids => bulkSeeds.push(ids)
    walletCacheLoaderHooks.onFallbackSeed = id => fallbackSeeds.push(id)

    // Hold the engines the whole time; both wallets must emit from
    // their caches alone:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Only the active wallet rides the bulk dispatch:
    await pollUntil(() => account.currencyWallets[walletIds[0]] != null)
    expect(bulkSeeds.length).equals(1)
    expect(bulkSeeds[0]).deep.equals([walletIds[0]])

    // The reactivated wallet seeds itself through its pixie's own read
    // (changeWalletStates pends until the deferred loads add the repo):
    await account.changeWalletStates({ [walletIds[1]]: { archived: false } })
    await pollUntil(() => account.currencyWallets[walletIds[1]] != null)
    expect(fallbackSeeds).deep.equals([walletIds[1]])
    expect(bulkSeeds.length).equals(1)

    release()
    await account.logout()
  })

  it('plugin settings loaded after an engine starts still reach it', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld()

    // Persist plugin settings the next warm login must deliver:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.currencyConfig.fakecoin.changeUserSettings({ balance: 4321 })
    await snooze(SAVE_WAIT_MS)
    await account.logout()

    // Warm login with both the deferred loads and the engines gated:
    const { gate: builtinGate, release: releaseBuiltin } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = builtinGate
    const { gate: engineGate, release: releaseEngine } = createEngineGate()
    fakePluginTestConfig.engineGate = engineGate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet2 = await account2.waitForCurrencyWallet(walletIds[0])

    // Let the deferred loads land while the engine is still gated, so
    // the watcher sees the loaded settings with no engine to apply
    // them to (plugin settings are deliberately not cached):
    releaseBuiltin()
    await pollUntil(
      () => account2.currencyConfig.fakecoin.builtinTokens.badf00d5 != null
    )
    await snooze(RACE_WAIT_MS)

    // The engine arrives late and must still receive those settings
    // (the fake engine reports its configured balance only when
    // changeUserSettings delivers it):
    releaseEngine()
    await pollUntil(() => wallet2.balanceMap.get(null) === '4321')
    await account2.logout()
  })

  it('logout during a pending account cache save cancels the write', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld()

    // Slow the saver down so its write is still pending at logout:
    accountCacheSaverConfig.throttleMs = 3000
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changeWalletStates({ [walletIds[1]]: { archived: true } })
    await account.logout()

    // The cancelled write must not have touched the cache: a gated
    // warm login still shows both wallets active:
    accountCacheSaverConfig.throttleMs = 50
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(sorted([...account2.activeWalletIds])).deep.equals(sorted(walletIds))
    release()
    await account2.logout()
  })

  it('fresh-process warm login boots from the cache alone', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First session: decorate, then capture the local cache files a
    // real device would still have on disk after the app closes:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletIds = [...account.activeWalletIds]
    const wallet = await account.waitForCurrencyWallet(walletIds[0])
    await account.waitForCurrencyWallet(walletIds[1])
    await wallet.renameWallet('Cached Name')
    await snooze(SAVE_WAIT_MS)

    const accountRepoInfo = account.getFirstWalletInfo(
      'account-repo:co.airbitz.wallet'
    )
    if (accountRepoInfo == null) throw new Error('Broken test account')
    const extraFiles: { [path: string]: string } = {}
    extraFiles[localPath(accountRepoInfo.id, 'accountCache.json')] =
      await account.localDisklet.getText('accountCache.json')
    for (const walletId of walletIds) {
      const cachedWallet = account.currencyWallets[walletId]
      extraFiles[localPath(walletId, 'walletCache.json')] =
        await cachedWallet.localDisklet.getText('walletCache.json')
      extraFiles[localPath(walletId, 'publicKey.json')] =
        await cachedWallet.localDisklet.getText('publicKey.json')
    }
    await account.logout()

    // A brand-new context is a fresh app process: a fresh Redux store
    // with no storage wallets, plus the files captured above. The
    // gated login must still resolve from the cache (regression guard:
    // an eager storage-wallet read here crashes the whole login):
    const context2 = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true },
      extraFiles
    })
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const { gate: engineGate, release: releaseEngines } = createEngineGate()
    fakePluginTestConfig.engineGate = engineGate
    const account2 = await context2.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const wallet2 = await account2.waitForCurrencyWallet(walletIds[0])
    expect(wallet2.name).equals('Cached Name')

    // Repo-backed calls made in the window pend instead of throwing
    // (this store has never seen addStorageWallet run):
    let syncSettled = false
    const syncPromise = account2.sync().then(() => {
      syncSettled = true
    })
    await snooze(RACE_WAIT_MS)
    expect(syncSettled).equals(false)

    // A custom token added during the boot window must reach the
    // synced repo once the deferred loads land, not just Redux:
    const tokenId = await account2.currencyConfig.fakecoin.addCustomToken({
      currencyCode: 'FRESH',
      displayName: 'Fresh Token',
      denominations: [{ multiplier: '100', name: 'FRESH' }],
      networkLocation: { contractAddress: '0xFRE54' }
    })
    release()
    releaseEngines()
    await syncPromise
    await pollUntilAsync(async () => {
      try {
        const text = await account2.disklet.getText('CustomTokens.json')
        return text.includes(tokenId)
      } catch (error: unknown) {
        return false
      }
    })
    expect(
      account2.currencyConfig.fakecoin.customTokens[tokenId]?.currencyCode
    ).equals('FRESH')
    await account2.logout()
  })

  it('caches config otherMethods names and keeps the live surface', async function () {
    this.timeout(15000)
    const { context } = await makeAccountCachedWorld()

    // The plugin's method names reached the account cache file (the
    // stub fallback consumes them if plugin loading ever defers past
    // the account emit; today the live plugin always wins):
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await snooze(SAVE_WAIT_MS)
    const text = await account.localDisklet.getText('accountCache.json')
    expect(text.includes('fakePluginMethod')).equals(true)

    // The live surface stays verbatim, including in the cache-seeded
    // boot window:
    const result =
      await account.currencyConfig.fakecoin.otherMethods.fakePluginMethod(
        'config'
      )
    expect(result).equals('fakePluginMethod called with: config')
    await account.logout()
  })

  it('rejects a corrupt account cache file and falls back cold', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld()

    // Corrupt the account cache after the saver has settled:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await snooze(SAVE_WAIT_MS)
    accountCacheSaverConfig.throttleMs = 5000
    await account.localDisklet.setText('accountCache.json', '{ "version": 99 }')
    await account.logout()
    accountCacheSaverConfig.throttleMs = 50

    // A corrupt file means the cold path runs: a gated login blocks,
    // exactly as with no cache at all:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    let settled = false
    const loginPromise = context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(account2 => {
        settled = true
        return account2
      })
    await snooze(RACE_WAIT_MS)
    expect(settled).equals(false)

    // Releasing the gate completes the boot and re-saves the cache:
    release()
    const account2 = await loginPromise
    expect(sorted([...account2.activeWalletIds])).deep.equals(sorted(walletIds))
    await snooze(SAVE_WAIT_MS)
    await account2.logout()

    // The rewritten file feeds the next gated login:
    const { gate: gate3, release: release3 } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate3
    const account3 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account3.activeWalletIds.length).equals(2)
    release3()
    await account3.logout()
  })
})

describe('write-path staleness', function () {
  beforeEach(function () {
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.publicKeyCheckGate = undefined
    accountCacheSaverConfig.throttleMs = 50
    walletCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.builtinTokensGate = undefined
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.publicKeyCheckGate = undefined
    accountCacheSaverConfig.throttleMs = 5000
    walletCacheSaverConfig.throttleMs = 5000
  })

  /**
   * Logs device A in and out once, so the background repo sync pulls
   * device B's pushed changes into A's local repo copy. The account
   * cache saver is stalled for the session, so A's account cache
   * stays as it was: the repo is now ahead of the cache, exactly the
   * state a warm boot walks into.
   */
  async function pullOnDeviceA(
    context: EdgeContext,
    pulled: (account: EdgeAccount) => Promise<boolean>
  ): Promise<void> {
    accountCacheSaverConfig.throttleMs = 5000
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.sync()
    await pollUntilAsync(async () => await pulled(account))
    await account.logout()
    accountCacheSaverConfig.throttleMs = 50
  }

  it('keeps custom tokens from another device across a boot-window edit', async function () {
    this.timeout(15000)
    const { context, customTokenId } = await makeAccountCachedWorld()

    // Put a second token in the synced repo but not in the account
    // cache, by stalling the cache saver for a session. This is the
    // divergence a second device's addCustomToken leaves behind once
    // sync delivers it: the repo is ahead of this device's cache:
    accountCacheSaverConfig.throttleMs = 5000
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const remoteTokenId = await account1.currencyConfig.fakecoin.addCustomToken(
      {
        currencyCode: 'REMOTE',
        displayName: 'Remote Token',
        denominations: [{ multiplier: '100', name: 'REMOTE' }],
        networkLocation: { contractAddress: '0xREM07E' }
      }
    )
    await pollUntilAsync(async () => {
      const text = await account1.disklet.getText('CustomTokens.json')
      return text.includes(remoteTokenId)
    })
    // Push the write out of the repo's pending-changes folder, so the
    // warm boot's background sync has nothing in flight:
    await account1.sync()
    await account1.logout()
    accountCacheSaverConfig.throttleMs = 50

    // Device A warm-boots on a cache that has never seen the remote
    // token, and adds its own token in the boot window:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const localTokenId = await account.currencyConfig.fakecoin.addCustomToken({
      currencyCode: 'LOCAL',
      displayName: 'Local Token',
      denominations: [{ multiplier: '100', name: 'LOCAL' }],
      networkLocation: { contractAddress: '0xL0CA1' }
    })

    // The saver must not write the cache-seeded map to disk
    // (that write is what would delete the remote token):
    await snooze(RACE_WAIT_MS)
    const preLoad = await account.disklet.getText('CustomTokens.json')
    expect(preLoad.includes(localTokenId)).equals(false)
    expect(preLoad.includes(remoteTokenId)).equals(true)

    // The load lands, merges, and the saver writes all three tokens:
    release()
    await pollUntilAsync(async () => {
      const text = await account.disklet.getText('CustomTokens.json')
      return (
        text.includes(customTokenId) &&
        text.includes(remoteTokenId) &&
        text.includes(localTokenId)
      )
    })
    const { customTokens } = account.currencyConfig.fakecoin
    expect(customTokens[customTokenId]?.currencyCode).equals('CACHED')
    expect(customTokens[remoteTokenId]?.currencyCode).equals('REMOTE')
    expect(customTokens[localTokenId]?.currencyCode).equals('LOCAL')
    await account.logout()

    // Wait for the cache savers to settle before the world closes,
    // so nothing writes into a destroyed context:
    await snooze(SAVE_WAIT_MS)
  })

  it('keeps enabled tokens from another device across a boot-window toggle', async function () {
    this.timeout(15000)
    const { context, world, walletIds, customTokenId } =
      await makeAccountCachedWorld()

    // Device B enables the builtin token and syncs it to the server:
    const contextB = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })
    const accountB = await contextB.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    const walletB = await accountB.waitForCurrencyWallet(walletIds[0])
    await walletB.changeEnabledTokenIds(['badf00d5'])
    await pollUntilAsync(async () => {
      const text = await walletB.disklet.getText('Tokens.json')
      return text.includes('badf00d5')
    })
    await walletB.sync()
    await accountB.logout()

    // Device A pulls the wallet repo. The wallet reloads its token
    // file mid-session, so stall the wallet cache saver to keep the
    // cache on the old empty list (the divergence under test):
    walletCacheSaverConfig.throttleMs = 5000
    await pullOnDeviceA(context, async account => {
      const wallet = await account.waitForCurrencyWallet(walletIds[0])
      const text = await wallet.disklet.getText('Tokens.json')
      return text.includes('badf00d5')
    })
    walletCacheSaverConfig.throttleMs = 50

    // Device A warm-boots on a cache with an empty enabled list. The
    // public-key gate holds the wallet's file loads, so the list the
    // user acts on is deterministically the stale cached one:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const { gate: pkGate, release: releasePk } = createEngineGate()
    fakePluginTestConfig.publicKeyCheckGate = pkGate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = await account.waitForCurrencyWallet(walletIds[0])
    expect([...wallet.enabledTokenIds]).deep.equals([])

    // Toggling the custom token pends on the builtin definitions:
    let toggleSettled = false
    const togglePromise = wallet
      .changeEnabledTokenIds([customTokenId])
      .then(() => {
        toggleSettled = true
      })
    await snooze(RACE_WAIT_MS)
    expect(toggleSettled).equals(false)

    // The toggle lands against the stale list...
    release()
    await togglePromise
    expect([...wallet.enabledTokenIds]).deep.equals([customTokenId])

    // ...and the racing load preserves it instead of erasing it,
    // while the toggle preserves the other device's enablement:
    releasePk()
    await pollUntil(
      () =>
        wallet.enabledTokenIds.includes('badf00d5') &&
        wallet.enabledTokenIds.includes(customTokenId)
    )
    await account.logout()
    await snooze(SAVE_WAIT_MS)
  })

  it('keeps a wallet-state change made against a stale cache', async function () {
    this.timeout(15000)
    const { context, walletIds } = await makeAccountCachedWorld({
      archiveSecond: true
    })

    // Put an "unarchived" record in the synced repo while the cache
    // still says "archived", by stalling the cache saver for a
    // session. This is the divergence a second device's unarchive
    // leaves behind once sync delivers it:
    accountCacheSaverConfig.throttleMs = 5000
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account1.changeWalletStates({ [walletIds[1]]: { archived: false } })
    // Push the write out of the repo's pending-changes folder, so the
    // warm boot's background sync has nothing in flight:
    await account1.sync()
    await account1.logout()
    accountCacheSaverConfig.throttleMs = 50

    // Device A warm-boots on a cache that still says "archived", and
    // the user re-affirms that. Against the stale cache this change
    // looks like a no-op, so it must wait for the load instead:
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.builtinTokensGate = gate
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account.archivedWalletIds.includes(walletIds[1])).equals(true)
    let changeSettled = false
    const changePromise = account
      .changeWalletStates({ [walletIds[1]]: { archived: true } })
      .then(() => {
        changeSettled = true
      })
    await snooze(RACE_WAIT_MS)
    expect(changeSettled).equals(false)

    // The load lands with device B's "unarchived" record, and the
    // change applies on top of it instead of silently reverting:
    release()
    await changePromise
    expect(account.archivedWalletIds.includes(walletIds[1])).equals(true)
    expect(account.activeWalletIds.includes(walletIds[1])).equals(false)
    await account.logout()
    await snooze(SAVE_WAIT_MS)
  })

  it('keeps plugin settings from another device across a local change', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const plugins = { fakecoin: true, fakeswap: true }
    const context = await world.makeEdgeContext({ ...contextOptions, plugins })
    const contextB = await world.makeEdgeContext({ ...contextOptions, plugins })

    // Device A logs in first, so its Redux settings predate B's write:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Device B changes the currency plugin's settings and syncs:
    const accountB = await contextB.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )
    await accountB.currencyConfig.fakecoin.changeUserSettings({
      remoteFlag: true
    })
    await accountB.sync()
    await accountB.logout()

    // Device A pulls the repo (no settings reload runs), then changes
    // a different plugin's settings. The writer must merge into the
    // freshly read file, not rebuild it from stale Redux:
    await account.sync()
    await account.swapConfig.fakeswap.changeUserSettings({ localFlag: true })
    const text = await account.disklet.getText('PluginSettings.json')
    expect(text.includes('remoteFlag')).equals(true)
    expect(text.includes('localFlag')).equals(true)
    await account.logout()

    // A fresh login sees both settings:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    expect(account2.currencyConfig.fakecoin.userSettings).deep.equals({
      remoteFlag: true
    })
    expect(account2.swapConfig.fakeswap.userSettings).deep.equals({
      localFlag: true
    })
    await account2.logout()
    await snooze(SAVE_WAIT_MS)
  })
})

/** The disklet path of a file on a wallet's or account's local storage. */
function localPath(id: string, file: string): string {
  return `local/${base58.stringify(base64.parse(id))}/${file}`
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

/** Polls an async condition, or fails the test after ~5s. */
async function pollUntilAsync(
  condition: () => Promise<boolean>
): Promise<void> {
  for (let i = 0; i < 100; ++i) {
    if (await condition()) return
    await snooze(50)
  }
  throw new Error('Timed out waiting for a test condition')
}

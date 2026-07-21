import { expect } from 'chai'
import { afterEach, beforeEach, describe, it } from 'mocha'
import { base64 } from 'rfc4648'

import { accountCacheSaverConfig } from '../../../src/core/account/account-cache-file'
import { walletCacheSaverConfig } from '../../../src/core/currency/wallet/wallet-cache-file'
import { walletCacheLoaderHooks } from '../../../src/core/currency/wallet/wallet-cache-loader'
import { EdgeContext, makeFakeEdgeWorld } from '../../../src/index'
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
  await account.logout()

  return { context, walletIds, customTokenId }
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

    // The deferred loads land and overwrite authoritatively, and the
    // cached token balance gains its currency code once the builtin
    // token definitions arrive:
    release()
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

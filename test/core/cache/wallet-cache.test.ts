/**
 * End-to-end tests for wallet caching (cache-first login).
 *
 * Tests the complete flow:
 * 1. Cache saving when balances/wallets change
 * 2. Cache loading on subsequent login (instant wallet display)
 * 3. Delegation from cached wallet to real wallet
 * 4. waitForCurrencyWallet returning cached wallet immediately
 */

import '../../fake/fake-plugins'

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index'
import { snooze } from '../../../src/util/snooze'
import { fakePluginTestConfig } from '../../fake/fake-currency-plugin'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

describe('wallet cache', function () {
  // Reset test config before and after each test
  beforeEach(function () {
    fakePluginTestConfig.engineDelayMs = 0
  })

  afterEach(function () {
    fakePluginTestConfig.engineDelayMs = 0
  })

  it('provides cached wallets before engine loads', async function () {
    this.timeout(35000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache normally (no delay)
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.renameWallet('Cached Wallet')
    await account1.currencyConfig.fakecoin.changeUserSettings({
      balance: 12345
    })

    // Wait for async balance callback to propagate through yaob bridge
    await snooze(100)

    // Verify balance is set
    expect(wallet1.balances.FAKE).equals('12345')

    // Wait for cache saver to write
    // The cache saver and change detector both run every 5s on independent schedules.
    // First checkForChanges marks dirty at ~5s, first doSave with data at ~10s.
    // Wait 15s to ensure at least one complete save cycle.
    await snooze(15000)

    // Verify the balance is still set before logout
    expect(wallet1.balances.FAKE).equals('12345')

    await account1.logout()

    // Second login - delay engine creation to verify cache is used
    fakePluginTestConfig.engineDelayMs = 5000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Check IMMEDIATELY - wallet must be from cache since engine is still delayed
    // (we only waited ~0ms, but engine takes 5000ms)
    const cachedWallet = account2.currencyWallets[walletInfo.id]
    expect(cachedWallet).not.equals(undefined, 'Cached wallet should exist')
    expect(cachedWallet.name).equals('Cached Wallet')
    expect(cachedWallet.balances.FAKE).equals('12345')

    // Cached wallet should show partial sync ratio (0.5) to indicate cache-loaded state
    expect(cachedWallet.syncRatio).equals(0.5)

    await account2.logout()
  })

  it('waitForCurrencyWallet returns cached wallet immediately', async function () {
    this.timeout(30000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    await account1.waitForCurrencyWallet(walletInfo.id)
    await account1.currencyConfig.fakecoin.changeUserSettings({ balance: 9999 })

    await snooze(12000)
    await account1.logout()

    // Second login - long engine delay
    fakePluginTestConfig.engineDelayMs = 10000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // waitForCurrencyWallet should return immediately (from cache), not wait 10s
    const startTime = Date.now()
    const wallet = await account2.waitForCurrencyWallet(walletInfo.id)
    const elapsed = Date.now() - startTime

    expect(elapsed).lessThan(
      1000,
      'waitForCurrencyWallet should return instantly from cache'
    )
    expect(wallet.balances.FAKE).equals('9999')

    await account2.logout()
  })

  it('delegates to real wallet after engine loads', async function () {
    this.timeout(30000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    await account1.waitForCurrencyWallet(walletInfo.id)
    await account1.currencyConfig.fakecoin.changeUserSettings({ balance: 5000 })

    await snooze(12000)
    await account1.logout()

    // Second login - short engine delay
    fakePluginTestConfig.engineDelayMs = 2000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Verify we have cached wallet immediately
    expect(wallet.balances.FAKE).equals('5000')

    // Wait LONGER than the engine delay to ensure engine has loaded
    await snooze(3000)

    // Now methods that require the engine should work via delegation
    // Set a new balance through the real engine
    await account2.currencyConfig.fakecoin.changeUserSettings({ balance: 7777 })

    // getTransactions requires the real engine
    const txs = await wallet.getTransactions({ tokenId: null })
    expect(txs).to.be.an('array')

    await account2.logout()
  })

  it('methods wait for real wallet instead of throwing', async function () {
    this.timeout(30000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    await account1.waitForCurrencyWallet(walletInfo.id)
    await account1.currencyConfig.fakecoin.changeUserSettings({ balance: 1000 })

    await snooze(12000)
    await account1.logout()

    // Second login - engine delayed
    fakePluginTestConfig.engineDelayMs = 2000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Call a method immediately (before engine loads)
    // It should wait for the engine, not throw an error
    const startTime = Date.now()
    const txs = await wallet.getTransactions({ tokenId: null })
    const elapsed = Date.now() - startTime

    // Should have waited for engine (approximately 2 seconds)
    expect(elapsed).greaterThan(1500, 'Should have waited for engine')
    expect(txs).to.be.an('array')

    await account2.logout()
  })

  it('caches token balances and enabled tokens', async function () {
    this.timeout(35000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - set up tokens
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)

    // Enable token and set balances
    await wallet1.changeEnabledTokenIds(['badf00d5'])
    await account1.currencyConfig.fakecoin.changeUserSettings({
      balance: 1000,
      tokenBalance: 5000
    })

    // Wait for async balance callback to propagate
    await snooze(100)

    expect(wallet1.balances.FAKE).equals('1000')
    expect(wallet1.balances.TOKEN).equals('5000')
    expect(wallet1.enabledTokenIds).deep.equals(['badf00d5'])

    await snooze(12000)
    await account1.logout()

    // Second login - verify cache includes tokens
    fakePluginTestConfig.engineDelayMs = 5000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    expect(cachedWallet.balances.FAKE).equals('1000')
    expect(cachedWallet.balances.TOKEN).equals('5000')
    expect(cachedWallet.enabledTokenIds).deep.equals(['badf00d5'])

    await account2.logout()
  })

  it('handles logout during pending operations gracefully', async function () {
    this.timeout(30000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    await account1.waitForCurrencyWallet(walletInfo.id)
    await account1.currencyConfig.fakecoin.changeUserSettings({ balance: 100 })

    await snooze(12000)
    await account1.logout()

    // Second login with delay
    fakePluginTestConfig.engineDelayMs = 5000

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Start a cache save cycle and logout quickly
    // (Intentionally not awaiting - testing graceful logout during pending ops)
    const config = account2.currencyConfig.fakecoin
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    config.changeUserSettings({ balance: 200 })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    config.changeUserSettings({ balance: 300 })

    // Logout while operations might be pending
    await account2.logout()

    // Should complete without errors
    expect(account2.loggedIn).equals(false)
  })
})

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

import { makeAssertLog } from 'assert-log'
import { expect } from 'chai'
import { describe, it } from 'mocha'

import { walletCacheSaverConfig } from '../../../src/core/cache/cache-wallet-saver'
import { makeFakeEdgeWorld } from '../../../src/index'
import { snooze } from '../../../src/util/snooze'
import {
  createEngineGate,
  fakePluginTestConfig
} from '../../fake/fake-currency-plugin'
import { fakeUser } from '../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '' }
const quiet = { onLog() {} }

const CACHE_SAVE_WAIT_MS = 100
const BRIDGE_SETTLE_MS = 50

describe('wallet cache', function () {
  // Reset test config before and after each test
  beforeEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.noOtherMethods = false
    walletCacheSaverConfig.throttleMs = 50
  })

  afterEach(function () {
    fakePluginTestConfig.engineGate = undefined
    fakePluginTestConfig.noOtherMethods = false
    walletCacheSaverConfig.throttleMs = undefined
  })

  it('provides cached wallets before engine loads', async function () {
    this.timeout(10000)

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
    await snooze(CACHE_SAVE_WAIT_MS)

    // Verify balance is set
    expect(wallet1.balances.FAKE).equals('12345')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)

    await account1.logout()

    // Second login - use gate to block engine creation and verify cache is used
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Check IMMEDIATELY - wallet must be from cache since engine is blocked by gate
    const cachedWallet = account2.currencyWallets[walletInfo.id]
    expect(cachedWallet).not.equals(undefined, 'Cached wallet should exist')
    expect(cachedWallet.name).equals('Cached Wallet')
    expect(cachedWallet.balances.FAKE).equals('12345')

    // Cached wallet should show partial sync ratio (0.05) to indicate cache-loaded state
    expect(cachedWallet.syncRatio).equals(0.05)

    await account2.logout()
  })

  it('waitForCurrencyWallet returns cached wallet immediately', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to block engine
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // waitForCurrencyWallet should return immediately (from cache), not wait for gate
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
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate, release immediately to let engine load
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Verify we have cached wallet immediately
    expect(wallet.balances.FAKE).equals('5000')

    // Release the gate to allow engine to load
    release()

    // Now methods that require the engine should work via delegation
    // Set a new balance through the real engine
    await account2.currencyConfig.fakecoin.changeUserSettings({ balance: 7777 })

    // getTransactions requires the real engine (will wait for it)
    const txs = await wallet.getTransactions({ tokenId: null })
    expect(txs).to.be.an('array')

    await account2.logout()
  })

  it('methods wait for real wallet instead of throwing', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control engine loading
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Call a method immediately (before engine loads)
    // It should wait for the engine, not throw an error
    let methodCompleted = false
    const txPromise = wallet.getTransactions({ tokenId: null }).then(txs => {
      methodCompleted = true
      return txs
    })

    // Wait enough for bridge hops to settle, verify it hasn't completed
    await snooze(BRIDGE_SETTLE_MS)
    expect(methodCompleted).equals(false, 'Method should wait for engine')

    // Release the gate to allow engine to load
    release()

    const txs = await txPromise
    expect(methodCompleted).equals(true)
    expect(txs).to.be.an('array')

    await account2.logout()
  })

  it('caches token balances and enabled tokens', async function () {
    this.timeout(10000)

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
    await snooze(CACHE_SAVE_WAIT_MS)

    expect(wallet1.balances.FAKE).equals('1000')
    expect(wallet1.balances.TOKEN).equals('5000')
    expect(wallet1.enabledTokenIds).deep.equals(['badf00d5'])

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to block engine, verify cache includes tokens
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    expect(cachedWallet.balances.FAKE).equals('1000')
    expect(cachedWallet.balances.TOKEN).equals('5000')
    expect(cachedWallet.enabledTokenIds).deep.equals(['badf00d5'])

    await account2.logout()
  })

  it('handles logout during pending operations gracefully', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login with gate to block engine
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

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

  it('caches otherMethods and they are callable from cached wallet', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - ensure otherMethods are saved to cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)

    // Verify otherMethods exist on real wallet
    expect(wallet1.otherMethods).to.be.an('object')
    expect(wallet1.otherMethods.testMethod).to.be.a('function')

    // Call otherMethod to verify it works
    const result1 = await wallet1.otherMethods.testMethod('hello')
    expect(result1).equals('testMethod called with: hello')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to block engine, verify otherMethods are in cached wallet
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Cached wallet should have otherMethods
    expect(cachedWallet.otherMethods).to.be.an('object')
    expect(cachedWallet.otherMethods.testMethod).to.be.a('function')

    await account2.logout()
  })

  it('otherMethods delegate to real wallet after engine loads', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache with otherMethods
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    await account1.waitForCurrencyWallet(walletInfo.id)

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate, release immediately to let engine load
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Verify we have cached wallet with otherMethods immediately
    expect(wallet.otherMethods).to.be.an('object')
    expect(wallet.otherMethods.testMethod).to.be.a('function')

    // Release the gate to allow engine to load
    release()

    // Now otherMethods should delegate to real engine (will wait if needed)
    const result = await wallet.otherMethods.testMethod('delegated')
    expect(result).equals('testMethod called with: delegated')

    await account2.logout()
  })

  it('otherMethods wait for real wallet if called immediately', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control engine loading
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Call otherMethod immediately (before engine loads)
    // It should wait for the engine, not throw an error
    let methodCompleted = false
    const resultPromise = wallet.otherMethods
      .testMethod('waiting')
      .then((r: string) => {
        methodCompleted = true
        return r
      })

    // Wait enough for bridge hops to settle, verify it hasn't completed
    await snooze(BRIDGE_SETTLE_MS)
    expect(methodCompleted).equals(false, 'Method should wait for engine')

    // Release the gate to allow engine to load
    release()

    const result = await resultPromise
    expect(methodCompleted).equals(true)
    expect(result).equals('testMethod called with: waiting')

    await account2.logout()
  })

  it('otherMethods are bridgeable (no serialization errors)', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate, release immediately for this test
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Access otherMethods - should not throw serialization errors
    // This tests that bridgifyObject was called on otherMethods
    expect(wallet.otherMethods).to.be.an('object')
    expect(typeof wallet.otherMethods.testMethod).equals('function')

    // Release gate before calling method
    release()

    // Calling the method should work without errors
    const result = await wallet.otherMethods.testMethod('bridged')
    expect(result).to.include('testMethod called with')

    await account2.logout()
  })

  it('handles wallets with no otherMethods gracefully', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login with otherMethods suppressed on the engine
    fakePluginTestConfig.noOtherMethods = true

    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)

    // Verify otherMethods are empty on real wallet
    expect(Object.keys(wallet1.otherMethods).length).equals(0)

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to block engine, should handle empty otherMethods
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Should still work, with empty otherMethods
    expect(cachedWallet).not.equals(undefined)
    expect(cachedWallet.otherMethods).to.be.an('object')
    expect(Object.keys(cachedWallet.otherMethods).length).equals(0)

    await account2.logout()
  })

  // ===========================================================================
  // Disklet delegation tests (using gate-based control, no timing)
  // ===========================================================================

  it('disklet.setText waits for real wallet during cache phase', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a write operation - it should wait (not reject immediately)
    let writeCompleted = false
    const writePromise = cachedWallet.disklet
      .setText('test-file.txt', 'test content')
      .then(() => {
        writeCompleted = true
      })

    // Wait enough for bridge hops to settle
    await snooze(BRIDGE_SETTLE_MS)
    expect(writeCompleted).equals(
      false,
      'Write should not complete before gate'
    )

    // Release the gate to allow engine to load
    release()

    // Wait for write to complete
    await writePromise
    expect(writeCompleted).equals(true, 'Write should complete after gate')

    // Verify data was written to the real disklet
    const content = await cachedWallet.disklet.getText('test-file.txt')
    expect(content).equals('test content')

    await account2.logout()
  })

  it('disklet.getText waits for real wallet during cache phase', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache and write a file
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.disklet.setText('existing-file.txt', 'persisted content')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a read operation - it should wait (not reject immediately)
    let readResult: string | undefined
    const readPromise = cachedWallet.disklet
      .getText('existing-file.txt')
      .then(content => {
        readResult = content
      })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(readResult).equals(undefined, 'Read should not complete before gate')

    // Release the gate to allow engine to load
    release()

    // Wait for read to complete
    await readPromise
    expect(readResult).equals('persisted content')

    await account2.logout()
  })

  it('disklet.setData waits for real wallet during cache phase', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a binary write operation - it should wait
    let writeCompleted = false
    const testData = new Uint8Array([1, 2, 3, 4, 5])
    const writePromise = cachedWallet.disklet
      .setData('binary-file.dat', testData)
      .then(() => {
        writeCompleted = true
      })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(writeCompleted).equals(
      false,
      'Write should not complete before gate'
    )

    // Release the gate
    release()

    await writePromise
    expect(writeCompleted).equals(true)

    // Verify data was written
    const readData = await cachedWallet.disklet.getData('binary-file.dat')
    expect(Array.from(readData)).deep.equals([1, 2, 3, 4, 5])

    await account2.logout()
  })

  it('disklet.getData waits for real wallet during cache phase', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache and write binary data
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.disklet.setData(
      'existing-binary.dat',
      new Uint8Array([10, 20, 30])
    )

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a binary read operation - it should wait
    let readResult: Uint8Array | undefined
    const readPromise = cachedWallet.disklet
      .getData('existing-binary.dat')
      .then(data => {
        readResult = data
      })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(readResult).equals(undefined, 'Read should not complete before gate')

    // Release the gate
    release()

    await readPromise
    if (readResult == null) throw new Error('Read result should not be null')
    expect(Array.from(readResult)).deep.equals([10, 20, 30])

    await account2.logout()
  })

  it('disklet.list waits for real wallet during cache phase', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache and create some files
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.disklet.setText('file-a.txt', 'a')
    await wallet1.disklet.setText('file-b.txt', 'b')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a list operation - it should wait
    let listResult: { [name: string]: 'file' | 'folder' } | undefined
    const listPromise = cachedWallet.disklet.list().then(result => {
      listResult = result
    })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(listResult).equals(undefined, 'List should not complete before gate')

    // Release the gate
    release()

    await listPromise
    expect(listResult).to.have.property('file-a.txt', 'file')
    expect(listResult).to.have.property('file-b.txt', 'file')

    await account2.logout()
  })

  it('disklet.delete waits for real wallet during cache phase', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache and create a file
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.disklet.setText('to-delete.txt', 'delete me')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start a delete operation - it should wait
    let deleteCompleted = false
    const deletePromise = cachedWallet.disklet
      .delete('to-delete.txt')
      .then(() => {
        deleteCompleted = true
      })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(deleteCompleted).equals(
      false,
      'Delete should not complete before gate'
    )

    // Release the gate
    release()

    await deletePromise
    expect(deleteCompleted).equals(true)

    // Verify file is deleted:
    try {
      await cachedWallet.disklet.getText('to-delete.txt')
      expect.fail('File should have been deleted')
    } catch (e) {
      expect(e).to.be.instanceOf(Error)
      expect((e as Error).message).to.match(
        /cannot load|cannot read|not found|ENOENT/i
      )
    }

    await account2.logout()
  })

  it('localDisklet operations wait for real wallet during cache phase', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - populate cache
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo.id)
    await wallet1.localDisklet.setText('local-file.txt', 'local content')

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start operations on localDisklet - they should wait
    let readCompleted = false
    let writeCompleted = false

    const readPromise = cachedWallet.localDisklet
      .getText('local-file.txt')
      .then(() => {
        readCompleted = true
      })

    const writePromise = cachedWallet.localDisklet
      .setText('new-local-file.txt', 'new local')
      .then(() => {
        writeCompleted = true
      })

    // Give a tick for any immediate rejection
    await snooze(BRIDGE_SETTLE_MS)
    expect(readCompleted).equals(false, 'Read should not complete before gate')
    expect(writeCompleted).equals(
      false,
      'Write should not complete before gate'
    )

    // Release the gate
    release()

    await Promise.all([readPromise, writePromise])
    expect(readCompleted).equals(true)
    expect(writeCompleted).equals(true)

    // Verify data persisted
    const content =
      await cachedWallet.localDisklet.getText('new-local-file.txt')
    expect(content).equals('new local')

    await account2.logout()
  })

  it('multiple disklet operations queue correctly during cache phase', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - use gate to control when engine loads
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const cachedWallet = account2.currencyWallets[walletInfo.id]

    // Start multiple operations before engine loads
    const operations: Array<Promise<void>> = []
    const completionOrder: number[] = []

    for (let i = 0; i < 5; i++) {
      const index = i
      operations.push(
        cachedWallet.disklet
          .setText(`file-${i}.txt`, `content-${i}`)
          .then(() => {
            completionOrder.push(index)
          })
      )
    }

    // None should complete yet
    await snooze(BRIDGE_SETTLE_MS)
    expect(completionOrder.length).equals(
      0,
      'No operations should complete before gate'
    )

    // Release the gate
    release()

    // All operations should complete
    await Promise.all(operations)
    expect(completionOrder.length).equals(5, 'All operations should complete')

    // Verify all files were written
    for (let i = 0; i < 5; i++) {
      const content = await cachedWallet.disklet.getText(`file-${i}.txt`)
      expect(content).equals(`content-${i}`)
    }

    await account2.logout()
  })

  it('disklet delegator works correctly after real wallet loads', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - release gate immediately to test post-load behavior
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Release immediately
    release()

    // Wait for wallet to fully load (use a method that requires real wallet)
    await wallet.getTransactions({ tokenId: null })

    // Now operations should go directly to the real disklet
    await wallet.disklet.setText('post-load-file.txt', 'post load content')
    const content = await wallet.disklet.getText('post-load-file.txt')
    expect(content).equals('post load content')

    // Test folder operations
    await wallet.disklet.setText('subfolder/nested.txt', 'nested content')
    const list = await wallet.disklet.list('subfolder')
    // Disklet returns keys with full relative paths from query root
    expect(list).to.have.property('subfolder/nested.txt', 'file')

    await account2.logout()
  })

  // Note: Testing that disklet operations properly reject when the wallet
  // never loads is covered implicitly by the MAX_WAIT_MS
  // timeout in the implementation. Testing this directly would require
  // waiting 60 seconds which is too long for unit tests.

  // ===========================================================================
  // Multiple wallet tests
  // ===========================================================================

  it('caches and restores multiple wallets correctly', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - create a second wallet
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo1 = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo1 == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo1.id)
    await wallet1.renameWallet('Wallet One')
    await account1.currencyConfig.fakecoin.changeUserSettings({
      balance: 1111
    })
    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)

    // Create a second wallet
    const wallet2Api = await account1.createCurrencyWallet('wallet:fakecoin', {
      name: 'Wallet Two'
    })
    const walletId2 = wallet2Api.id

    // Wait for cache saver to write both wallets
    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)

    // Verify both wallets exist before logout
    expect(account1.currencyWallets[walletInfo1.id]).not.equals(undefined)
    expect(account1.currencyWallets[walletId2]).not.equals(undefined)

    await account1.logout()

    // Second login - use gate to block engine, verify both wallets cached
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const cached1 = account2.currencyWallets[walletInfo1.id]
    const cached2 = account2.currencyWallets[walletId2]

    // Both wallets should exist from cache
    expect(cached1).not.equals(undefined, 'First wallet should be cached')
    expect(cached2).not.equals(undefined, 'Second wallet should be cached')

    // Verify they have distinct data
    expect(cached1.name).equals('Wallet One')
    expect(cached2.name).equals('Wallet Two')
    expect(cached1.id).not.equals(cached2.id)

    // Verify activeWalletIds contains both
    expect(account2.activeWalletIds).to.include(walletInfo1.id)
    expect(account2.activeWalletIds).to.include(walletId2)

    await account2.logout()
  })

  it('excludes archived wallets from cache on next login', async function () {
    this.timeout(10000)

    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakecoin: true }
    })

    // First login - create two wallets
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const walletInfo1 = account1.getFirstWalletInfo('wallet:fakecoin')
    if (walletInfo1 == null) throw new Error('No wallet')

    const wallet1 = await account1.waitForCurrencyWallet(walletInfo1.id)
    await wallet1.renameWallet('Keep Me')

    const wallet2Api = await account1.createCurrencyWallet('wallet:fakecoin', {
      name: 'Archive Me'
    })
    const walletId2 = wallet2Api.id

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)

    // Verify both are active
    expect(account1.activeWalletIds).to.include(walletInfo1.id)
    expect(account1.activeWalletIds).to.include(walletId2)

    // Archive the second wallet
    await account1.changeWalletStates({ [walletId2]: { archived: true } })

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)

    expect(account1.activeWalletIds).to.not.include(walletId2)

    await account1.logout()

    // Second login - use gate to block engine, verify only active wallet cached
    const { gate } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const cached1 = account2.currencyWallets[walletInfo1.id]
    const cached2 = account2.currencyWallets[walletId2]

    expect(cached1).not.equals(undefined, 'Active wallet should be cached')
    expect(cached1.name).equals('Keep Me')

    expect(cached2).equals(
      undefined,
      'Archived wallet should not appear in currencyWallets'
    )

    expect(account2.activeWalletIds).to.include(walletInfo1.id)
    expect(account2.activeWalletIds).to.not.include(walletId2)

    await account2.logout()
  })

  // ===========================================================================
  // yaob bridge propagation tests
  // ===========================================================================

  it('watch fires for changePaused on cached wallet', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - gate blocks engine, wallet comes from cache
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]
    expect(wallet).not.equals(undefined, 'Cached wallet should exist')

    // Wallet should start paused (pauseWallets is false in tests)
    expect(wallet.paused).equals(false)

    // Set up watch listener
    const log = makeAssertLog()
    wallet.watch('paused', paused => log('paused', paused))

    // Release gate so changePaused can delegate to real wallet
    release()

    // Call changePaused - should delegate and update through yaob
    await wallet.changePaused(true)
    log.assert('paused true')

    await wallet.changePaused(false)
    log.assert('paused false')

    await account2.logout()
  })

  it('watch fires for renameWallet on cached wallet', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - gate blocks engine
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Set up watch listener
    const log = makeAssertLog()
    wallet.watch('name', name => log('name', name))

    // Release gate so renameWallet can delegate
    release()

    await wallet.renameWallet('New Cache Name')
    log.assert('name New Cache Name')

    await account2.logout()
  })

  it('watch fires for setFiatCurrencyCode on cached wallet', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - gate blocks engine
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Set up watch listener
    const log = makeAssertLog()
    wallet.watch('fiatCurrencyCode', code => log('fiat', code))

    // Release gate so setFiatCurrencyCode can delegate
    release()

    await wallet.setFiatCurrencyCode('iso:EUR')
    log.assert('fiat iso:EUR')

    await account2.logout()
  })

  it('watch fires for changeEnabledTokenIds on cached wallet', async function () {
    this.timeout(10000)

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

    // Wait for cache saver to write (throttled to 50ms in tests):
    await snooze(CACHE_SAVE_WAIT_MS)
    await account1.logout()

    // Second login - gate blocks engine
    const { gate, release } = createEngineGate()
    fakePluginTestConfig.engineGate = gate

    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const wallet = account2.currencyWallets[walletInfo.id]

    // Set up watch listener
    const log = makeAssertLog()
    wallet.watch('enabledTokenIds', tokenIds =>
      log('tokens', tokenIds.join(','))
    )

    // Release gate so changeEnabledTokenIds can delegate
    release()

    await wallet.changeEnabledTokenIds(['badf00d5'])
    log.assert('tokens badf00d5')

    await account2.logout()
  })
})

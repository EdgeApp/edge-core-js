import { makeAssertLog } from 'assert-log'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import {
  EdgeAccount,
  EdgeWalletInfoFull,
  makeFakeEdgeWorld
} from '../../../src/index'
import { expectRejection } from '../../expect-rejection'
import { fakeUser } from '../../fake/fake-user'

const plugins = { fakecoin: true }
const contextOptions = { apiKey: '', appId: '', plugins }
const quiet = { onLog() {} }

function findWallet(
  walletInfos: EdgeWalletInfoFull[],
  type: string
): EdgeWalletInfoFull | undefined {
  return walletInfos.find(info => info.type === type)
}

describe('account', function () {
  it('has basic information', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(account.appId).equals('')
    expect(account.loggedIn).equals(true)
    expect(account.rootLoginId).deep.equals(
      'BTnpEn7pabDXbcv7VxnKBDsn4CVSwLRA25J8U84qmg4h'
    )
    expect(account.username).equals('js test 0')
  })

  it('has basic information for child apps', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      appId: 'test-child-child'
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(account.appId).equals('test-child-child')
    expect(account.loggedIn).equals(true)
    expect(account.rootLoginId).deep.equals(
      'BTnpEn7pabDXbcv7VxnKBDsn4CVSwLRA25J8U84qmg4h'
    )
    expect(account.username).equals('js test 0')
  })

  it('calls callbacks', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const log = makeAssertLog()
    account.watch('allKeys', () => log('called'))
    log.assert()
    await account.createWallet('wallet:fakecoin')
    log.assert('called')
  })

  it('find repo', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const { allKeys } = account
    const accountRepo = findWallet(allKeys, 'account-repo:co.airbitz.wallet')
    if (accountRepo == null) throw new Error('Missing repo')
    assert.equal(accountRepo.keys.syncKey, fakeUser.syncKey)
    assert(findWallet(allKeys, 'account-repo:blah') == null)
  })

  it('attach repo', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const keys = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    const id = await account.createWallet('account-repo:blah', keys)
    const info = account.allKeys.find(info => info.id === id)
    if (info == null) throw new Error('Missing key info')
    assert.deepEqual(info.keys, keys)
  })

  it('create wallet', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const id = await account.createWallet('wallet:fakecoin')
    const info = account.allKeys.find(info => info.id === id)
    if (info == null) throw new Error('Missing key info')
    assert.equal(info.keys.fakeKey, 'FakePrivateKey')
  })

  it('create currency wallet', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account: EdgeAccount = await context.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )

    const wallet = await account.createCurrencyWallet('wallet:fakecoin', {
      fiatCurrencyCode: 'iso:JPY',
      migratedFromWalletId: 'asdf',
      name: 'test wallet'
    })
    assert.equal(wallet.name, 'test wallet')
    assert.equal(wallet.fiatCurrencyCode, 'iso:JPY')
    const walletInfo = account.allKeys.find(info => info.id === wallet.id)
    assert.equal(walletInfo?.migratedFromWalletId, 'asdf')
  })

  it('list keys', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const allTypes = account.allKeys.map(info => info.type)
    expect(allTypes).deep.equals([
      'wallet:bitcoin',
      'account-repo:co.airbitz.wallet',
      'wallet:fakecoin',
      'wallet:fakecoin'
    ])

    const allAppIds = account.allKeys.map(info => info.appIds)
    expect(allAppIds).deep.equals([[''], [''], [''], ['test-child']])
  })

  it('list active wallet ids', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ids = account.activeWalletIds
    expect(ids).deep.equals([
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=',
      '3ZR9nMKd0vpZgEcSbehoBsLoLlFWMJhBbsxTs/d/jqA='
    ])
  })

  it('change currency plugin settings', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const settings = {
      testSetting: 'some important string'
    }
    const config1 = account1.currencyConfig.fakecoin
    await config1.changeUserSettings(settings)
    expect(config1.userSettings).deep.equals(settings)

    // Log in again, and the setting should still be there:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const config2 = account2.currencyConfig.fakecoin
    expect(config2.userSettings).deep.equals(settings)
  })

  it('change swap plugin settings', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakeswap: true }
    })
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Check the initial settings:
    expect(account1.swapConfig).has.keys('fakeswap')

    const config1 = account1.swapConfig.fakeswap
    expect(config1.swapInfo.pluginId).equals('fakeswap')
    expect(config1.needsActivation).equals(true)
    expect(config1.userSettings).equals(undefined)

    // Change the settings:
    const settings = { kycToken: 'fake-token' }
    await config1.changeUserSettings(settings)
    expect(config1.userSettings).deep.equals(settings)
    expect(config1.needsActivation).equals(false)

    // Log in again, and the setting should still be there:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const config2 = account2.swapConfig.fakeswap
    expect(config2.userSettings).deep.equals(settings)
    expect(config1.needsActivation).equals(false)
  })

  it('disable swap plugin', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: { fakeswap: true }
    })

    // Check the initial settings:
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const config1 = account1.swapConfig.fakeswap
    expect(config1.enabled).equals(true)
    await config1.changeEnabled(false)
    expect(config1.enabled).equals(false)

    // Log in again, and the setting should still be there:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const config2 = account2.swapConfig.fakeswap
    expect(config2.enabled).equals(false)
    await config2.changeEnabled(true)
    expect(config2.enabled).equals(true)
  })

  it('change key state', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.changeWalletStates({
      'l3A0+Sx7oNFmrmRa1eefkCxbF9Y3ya9afVadVOBLgT8=': { sortIndex: 1 },
      'JN4meEIJO05QhDMN3QZd48Qh7F1xHUpUmy2oEhg9DdY=': { deleted: true },
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { sortIndex: 0 }
    })
    await account.changeWalletStates({
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { archived: true }
    })
    const allKeys = account.allKeys
    assert.equal(allKeys[0].sortIndex, 1)
    assert.equal(allKeys[1].deleted, true)
    assert.equal(allKeys[2].sortIndex, 0)
    assert.equal(allKeys[2].archived, true)
  })

  it('split wallet', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const fakecoinWallet = account.getFirstWalletInfo('wallet:fakecoin')
    if (fakecoinWallet == null) throw new Error('Missing wallet')

    // We should be able to split another type:
    expect(
      await account.listSplittableWalletTypes(fakecoinWallet.id)
    ).deep.equals(['wallet:tulipcoin'])

    // Do the split:
    await account.splitWalletInfo(fakecoinWallet.id, 'wallet:tulipcoin')
    const tulipWallet = account.getFirstWalletInfo('wallet:tulipcoin')
    if (tulipWallet == null) throw new Error('Missing wallet')

    // Check the keys:
    expect(fakecoinWallet.keys.dataKey).equals(tulipWallet.keys.dataKey)
    expect(fakecoinWallet.keys.fakecoinKey).equals(
      tulipWallet.keys.tulipcoinKey
    )

    // Now that the wallet is split, we can't split again:
    expect(
      await account.listSplittableWalletTypes(fakecoinWallet.id)
    ).deep.equals([])

    // Splitting back should not work:
    await expectRejection(
      account.splitWalletInfo(tulipWallet.id, 'wallet:fakecoin'),
      'Error: This wallet has already been split'
    )
  })

  it('hides keys', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext({
      ...contextOptions,
      hideKeys: true
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Sensitive properties don't work:
    expect(() => account.loginKey).throw()

    // Changing credentials doesn't work:
    await expectRejection(
      account.changePassword('password'),
      'Error: Not available when `hideKeys` is enabled'
    )

    // The wallet list is sanitized:
    for (const info of account.allKeys) {
      expect(info.keys).deep.equals({})
    }
  })

  it('logout', async function () {
    const log = makeAssertLog()
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    account.watch('loggedIn', loggedIn => log(loggedIn))
    await account.logout()
    log.assert('false')
    expect(account.loggedIn).equals(false)
    expect(account.username).equals('js test 0')
  })
})

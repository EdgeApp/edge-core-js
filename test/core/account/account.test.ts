import { makeAssertLog } from 'assert-log'
import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  EdgeAccount,
  EdgeWalletInfoFull,
  makeFakeEdgeWorld
} from '../../../src/index'
import { expectRejection } from '../../expect-rejection'
import { fakeUser } from '../../fake/fake-user'

const plugins = { fakecoin: true, tulipcoin: true }
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

  it('has basic information for duress accounts', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')

    expect(duressAccount.appId).equals('.duress')
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
    expect(accountRepo.id).equals(
      'JN4meEIJO05QhDMN3QZd48Qh7F1xHUpUmy2oEhg9DdY='
    )
    expect(findWallet(allKeys, 'account-repo:blah')).equals(undefined)
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
    expect(await account.getRawPrivateKey(id)).deep.equals(keys)
  })

  it('create wallet', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const id = await account.createWallet('wallet:fakecoin')
    const info = account.allKeys.find(info => info.id === id)
    if (info == null) throw new Error('Missing key info')
    const keys = await account.getRawPrivateKey(id)
    expect(keys.fakeKey).equals('FakePrivateKey')
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
      name: 'test wallet',
      enabledTokenIds: ['badf00d5']
    })
    expect(wallet.name).equals('test wallet')
    expect(wallet.fiatCurrencyCode).equals('iso:JPY')
    const walletInfo = account.allKeys.find(info => info.id === wallet.id)
    expect(walletInfo?.migratedFromWalletId).equals('asdf')
    expect(wallet.enabledTokenIds).deep.equals(['badf00d5'])
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

  it('provides access to keys', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const walletId = 'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54='
    expect(account.getWalletInfo(walletId)?.created).deep.equals(
      new Date('2024-01-01')
    )
    expect(await account.getRawPrivateKey(walletId)).deep.equals({
      dataKey: 'RlY1l6wQ5ntQgUHE70vG/2M/qiLdvWMnIAM7KJIcsDs=',
      fakecoinKey: 'zARFBBkgUe6pYB6l',
      syncKey: 'XKg8OnJCRNUZrsSe/lqPyWxvzaw='
    })
    expect(await account.getRawPublicKey(walletId)).deep.equals({
      fakeAddress: 'FakePublicAddress'
    })
    expect(await account.getDisplayPrivateKey(walletId)).deep.equals('xpriv')
    expect(await account.getDisplayPublicKey(walletId)).deep.equals('xpub')
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
    expect(allKeys[0].sortIndex).equals(1)
    expect(allKeys[1].deleted).equals(true)
    expect(allKeys[2].sortIndex).equals(0)
    expect(allKeys[2].archived).equals(true)
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
      'Error: This wallet has already been split (wallet:fakecoin)'
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
    expect(() => account.recoveryKey).throw()

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

  it('disable pin while in duress account should disable for main account', async function () {
    this.timeout(15000)
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')
    await duressAccount.changePin({ enableLogin: false })
    // Pin should be disabled for account:
    expect(
      context.localUsers.map(({ pinLoginEnabled, username }) => ({
        pinLoginEnabled,
        username
      }))
    ).deep.include.members([{ username: 'js test 0', pinLoginEnabled: false }])
  })

  it('disable pin while in duress account is temporary', async function () {
    const world = await makeFakeEdgeWorld([fakeUser], quiet)
    const context = await world.makeEdgeContext(contextOptions)

    // Enable duress account:
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    await account.changePin({ pin: '0000', forDuressAccount: true })
    await account.disableOtp()
    await account.logout()

    // Disable pin in duress account:
    const duressAccount = await context.loginWithPIN(fakeUser.username, '0000')
    await duressAccount.changePin({ enableLogin: false })
    await duressAccount.logout()
    // Forget account:
    await context.forgetAccount(account.rootLoginId)

    // Login with password:
    const topicAccount = await context.loginWithPassword(
      fakeUser.username,
      fakeUser.password,
      {
        otpKey: 'HELLO'
      }
    )
    // Pin should be disabled for account because it is still in duress mode:
    expect(
      context.localUsers.map(({ pinLoginEnabled, username }) => ({
        pinLoginEnabled,
        username
      }))
    ).deep.include.members([
      { username: fakeUser.username.toLowerCase(), pinLoginEnabled: true }
    ])

    await topicAccount.changePin({ enableLogin: true })
    await topicAccount.logout()

    // Login with non-duress PIN:
    await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    // Pin should be enabled for account:
    expect(
      context.localUsers.map(({ pinLoginEnabled, username }) => ({
        pinLoginEnabled,
        username
      }))
    ).deep.include.members([
      { username: fakeUser.username.toLowerCase(), pinLoginEnabled: true }
    ])
  })
})

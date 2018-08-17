// @flow

import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import type { EdgeAccount } from '../../../src/edge-core-index.js'
import { fakeUser, makeFakeContexts } from '../../../src/edge-core-index.js'
import { base64 } from '../../../src/util/encoding.js'
import { makeAssertLog } from '../../assert-log.js'
import { makeFakeCurrency } from '../../fake-plugins/fake-currency.js'

const contextOptions = {
  localFakeUser: true,
  plugins: [makeFakeCurrency()]
}

function findWallet (walletInfos, type) {
  return walletInfos.find(info => info.type === type)
}

describe('account', function () {
  it('calls callbacks', async function () {
    const [context] = makeFakeContexts(contextOptions)

    let callbackCalled = false
    const callbacks = {
      onDataChanged () {
        callbackCalled = true
      }
    }

    await context.loginWithPIN(fakeUser.username, fakeUser.pin, { callbacks })
    assert(callbackCalled)
  })

  it('find repo', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const { allKeys } = account
    const accountRepo = findWallet(allKeys, 'account-repo:co.airbitz.wallet')
    if (!accountRepo) throw new Error('Missing repo')
    assert.equal(accountRepo.keys.syncKey, base64.stringify(fakeUser.syncKey))
    assert(findWallet(allKeys, 'account-repo:blah') == null)
  })

  it('attach repo', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const keys = {
      dataKey: 'fa57',
      syncKey: 'f00d'
    }
    const id = await account.createWallet('account-repo:blah', keys)
    const info = account.allKeys.find(info => info.id === id)
    if (!info) throw new Error('Missing key info')
    assert.deepEqual(info.keys, keys)
  })

  it('create wallet', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const id = await account.createWallet('wallet:fakecoin')
    const info = account.allKeys.find(info => info.id === id)
    if (!info) throw new Error('Missing key info')
    assert.equal(info.keys.fakeKey, 'FakePrivateKey')
  })

  it('create currency wallet', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account: EdgeAccount = await context.loginWithPIN(
      fakeUser.username,
      fakeUser.pin
    )

    const wallet = await account.createCurrencyWallet('wallet:fakecoin', {
      name: 'test wallet',
      fiatCurrencyCode: 'iso:JPY'
    })
    assert.equal(wallet.name, 'test wallet')
    assert.equal(wallet.fiatCurrencyCode, 'iso:JPY')
  })

  it('list keys', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const allTypes = account.allKeys.map(info => info.type)
    expect(allTypes).to.deep.equal([
      'wallet:bitcoin',
      'account-repo:co.airbitz.wallet',
      'wallet:fakecoin',
      'wallet:fakecoin'
    ])

    const allAppIds = account.allKeys.map(info => info.appIds)
    expect(allAppIds).to.deep.equal([[''], [''], [''], ['test-child']])
  })

  it('list active wallet ids', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const ids = account.activeWalletIds
    expect(ids).to.deep.equal([
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=',
      '3ZR9nMKd0vpZgEcSbehoBsLoLlFWMJhBbsxTs/d/jqA='
    ])
  })

  it('list currency plugins', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyTools)).deep.equals(['testcoin'])
    const tools = account.currencyTools['testcoin']
    expect(tools.currencyInfo.pluginName).equals('testcoin')
  })

  it('change currency plugin settings', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account1 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const settings = {
      testSetting: 'some important string'
    }
    const tools1 = account1.currencyTools['testcoin']
    await tools1.changePluginSettings(settings)
    expect(tools1.pluginSettings).deep.equals(settings)

    // Log in again, and the setting should still be there:
    const account2 = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    const tools2 = account2.currencyTools['testcoin']
    expect(tools2.pluginSettings).deep.equals(settings)
  })

  it('change key state', async function () {
    const [context] = makeFakeContexts(contextOptions)
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
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const fakecoinWallet = account.getFirstWalletInfo('wallet:fakecoin')
    if (!fakecoinWallet) throw new Error('Missing wallet')

    // We should be able to split another type:
    expect(
      await account.listSplittableWalletTypes(fakecoinWallet.id)
    ).to.deep.equal(['wallet:tulipcoin'])

    // Do the split:
    await account.splitWalletInfo(fakecoinWallet.id, 'wallet:tulipcoin')
    const tulipWallet = account.getFirstWalletInfo('wallet:tulipcoin')
    if (!tulipWallet) throw new Error('Missing wallet')

    // Check the keys:
    expect(fakecoinWallet.keys.dataKey).to.equal(tulipWallet.keys.dataKey)
    expect(fakecoinWallet.keys.fakecoinKey).to.equal(
      tulipWallet.keys.tulipcoinKey
    )

    // Now that the wallet is split, we can't split again:
    expect(
      await account.listSplittableWalletTypes(fakecoinWallet.id)
    ).to.deep.equal([])

    // Splitting back should not work:
    expect(
      await account
        .splitWalletInfo(tulipWallet.id, 'wallet:fakecoin')
        .then(s => 'ok', e => 'fail')
    ).to.equal('fail')
  })

  it('logout', async function () {
    const log = makeAssertLog()
    const callbacks = {
      onLoggedOut () {
        log('logout')
      }
    }

    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(
      fakeUser.username,
      fakeUser.pin,
      { callbacks }
    )
    await account.logout()
    log.assert(['logout'])
  })
})

// @flow
import type { AbcAccount } from 'airbitz-core-types'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeCurrency } from '../../fake-plugins/fakeCurrency.js'
import { fakeUser, makeFakeContexts } from '../../indexABC.js'
import { base64 } from '../../util/encoding.js'

const contextOptions = {
  localFakeUser: true,
  plugins: [makeFakeCurrency()]
}

function findKeys (keyInfos, type) {
  return keyInfos.find(info => info.type === type)
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
    const accountRepo = findKeys(allKeys, 'account-repo:co.airbitz.wallet')
    if (!accountRepo) throw new Error('Missing repo')
    assert.equal(accountRepo.keys.syncKey, base64.stringify(fakeUser.syncKey))
    assert(findKeys(allKeys, 'account-repo:blah') == null)
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
    const account: AbcAccount = await context.loginWithPIN(
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

  it('change key state', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    await account.changeKeyStates({
      'l3A0+Sx7oNFmrmRa1eefkCxbF9Y3ya9afVadVOBLgT8=': { sortIndex: 1 },
      'JN4meEIJO05QhDMN3QZd48Qh7F1xHUpUmy2oEhg9DdY=': { deleted: true },
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { sortIndex: 0 }
    })
    await account.changeKeyStates({
      'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { archived: true }
    })
    const allKeys = account.allKeys
    assert.equal(allKeys[0].sortIndex, 1)
    assert.equal(allKeys[1].deleted, true)
    assert.equal(allKeys[2].sortIndex, 0)
    assert.equal(allKeys[2].archived, true)
  })

  it('logout', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)
    return account.logout()
  })
})

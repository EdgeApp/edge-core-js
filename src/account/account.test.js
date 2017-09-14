// @flow
import { fakeUser, makeFakeContexts } from '../indexABC.js'
import { makeFakeCurrency } from '../test/fakeCurrency.js'
import { base64 } from '../util/encoding.js'
import { assert } from 'chai'
import { describe, it } from 'mocha'

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

  it('list keys', async function () {
    const [context] = makeFakeContexts(contextOptions)
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    const allTypes = account.allKeys.map(info => info.type)
    assert.deepEqual(allTypes, [
      'wallet:bitcoin',
      'account-repo:co.airbitz.wallet',
      'wallet:fakecoin'
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

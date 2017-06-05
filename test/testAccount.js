/* global describe, it */
import { makeContext, makeFakeIos } from '../src'
import { base64 } from '../src/util/encoding.js'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

function makeFakeContexts (count) {
  return makeFakeIos(count).map(io => makeContext({ io }))
}

function findKeys (login, type) {
  return login.keyInfos.find(info => info.type === type)
}

describe('account', function () {
  it('find repo', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account => {
      const login = account.login
      const accountRepo = findKeys(login, 'account-repo:co.airbitz.wallet')
      assert(accountRepo)
      assert.equal(accountRepo.keys.syncKey, base64.stringify(fakeUser.syncKey))
      assert(findKeys(login, 'account-repo:blah') == null)
      return null
    })
  })

  it('attach repo', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account => {
      const keys = {
        dataKey: 'fa57',
        syncKey: 'f00d'
      }
      return account.createWallet('account-repo:blah', keys).then(id => {
        const info = account.login.keyInfos.find(info => info.id === id)

        assert.deepEqual(info.keys, keys)
        return null
      })
    })
  })
})

/* global describe, it */
import { makeContext, makeFakeIos } from '../indexABC.js'
import { fakeUser, makeFakeAccount } from '../test/fakeUser.js'
import { base64 } from '../util/encoding.js'
import assert from 'assert'

function makeFakeContexts (count) {
  return makeFakeIos(count).map(io => makeContext({ io }))
}

function findKeys (keyInfos, type) {
  return keyInfos.find(info => info.type === type)
}

describe('account', function () {
  it('find repo', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account => {
      const { allKeys } = account
      const accountRepo = findKeys(allKeys, 'account-repo:co.airbitz.wallet')
      assert(accountRepo)
      assert.equal(accountRepo.keys.syncKey, base64.stringify(fakeUser.syncKey))
      assert(findKeys(allKeys, 'account-repo:blah') == null)
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
        const info = account.allKeys.find(info => info.id === id)

        assert.deepEqual(info.keys, keys)
        return null
      })
    })
  })

  it('list keys', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account => {
      const allTypes = account.allKeys.map(info => info.type)
      assert.deepEqual(allTypes, [
        'wallet:bitcoin',
        'account-repo:co.airbitz.wallet',
        'wallet:fakecoin'
      ])
      return null
    })
  })

  it('change key state', function () {
    const [context] = makeFakeContexts(1)

    return makeFakeAccount(context, fakeUser).then(account =>
      account
        .changeKeyStates({
          'l3A0+Sx7oNFmrmRa1eefkCxbF9Y3ya9afVadVOBLgT8=': { sortIndex: 1 },
          'JN4meEIJO05QhDMN3QZd48Qh7F1xHUpUmy2oEhg9DdY=': { deleted: true },
          'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { sortIndex: 0 }
        })
        .then(() =>
          account.changeKeyStates({
            'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=': { archived: true }
          })
        )
        .then(() => {
          const allKeys = account.allKeys
          assert.equal(allKeys[0].sortIndex, 1)
          assert.equal(allKeys[1].deleted, true)
          assert.equal(allKeys[2].sortIndex, 0)
          assert.equal(allKeys[2].archived, true)
          return null
        })
    )
  })

  it('logout', function (done) {
    const [context] = makeFakeContexts(1)
    assert.doesNotThrow(() => {
      makeFakeAccount(context, fakeUser).then(account => {
        account.logout().then(() => {
          done()
          return null
        })
        return null
      })
    })
  })
})

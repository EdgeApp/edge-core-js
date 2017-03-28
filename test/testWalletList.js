/* global describe, it */
import {makeFakeContexts} from '../src'
import {Repo} from '../src/util/repo.js'
import {WalletList} from '../src/util/walletList.js'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

describe('wallet list', function () {
  it('raw id list', function () {
    const [context] = makeFakeContexts(1)
    makeFakeAccount(context, fakeUser)
    const repo = new Repo(context.io, fakeUser.loginKey, fakeUser.syncKey)
    const list = new WalletList(repo)

    assert.deepEqual(list.listIds(), ['7QjUtdhLqh6F84yPRi5D2MmubsYBtyai6YY3WqyPfK64'])
  })

  it('account id list', function () {
    const [context] = makeFakeContexts(1)
    const account = makeFakeAccount(context, fakeUser)
    const ids = account.listWalletIds()
    assert.equal(ids.length, 1)
    assert.equal(account.getWallet(ids[0]).type, 'account-repo:co.airbitz.wallet')
  })

  it('create', function (done) {
    const [context] = makeFakeContexts(1)
    const account = makeFakeAccount(context, fakeUser)

    const type = 'wallet:repo:magic'
    const keysJson = {
      magicKey: 'poof'
    }
    assert.equal(account.getFirstWallet(type), null)
    account.createWallet(type, keysJson, function (err, id) {
      if (err) return done(err)
      const wallet = account.getWallet(id)
      assert.equal(wallet.type, type)
      assert.equal(wallet.keys['magicKey'], keysJson.magicKey)
      assert.equal(account.listWalletIds().length, 2)
      assert.deepEqual(account.getFirstWallet(type), wallet)
      done()
    })
  })
})

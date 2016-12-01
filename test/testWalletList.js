/* global describe, it */
import assert from 'assert'

import * as packages from './fake/packages.js'
import {Repo} from '../src/util/repo.js'
import {makeSession} from './fake/session.js'
import {WalletList} from '../src/util/walletList.js'

describe('wallet list', function () {
  it('raw id list', function () {
    const session = makeSession({needsContext: true})
    session.storage.populateRepos()
    const repo = new Repo(session.context, packages.dataKey, packages.syncKey)
    const list = new WalletList(repo)

    assert.deepEqual(list.listIds(), ['7QjUtdhLqh6F84yPRi5D2MmubsYBtyai6YY3WqyPfK64'])
  })

  it('account id list', function () {
    const session = makeSession({needsAccount: true})
    const ids = session.account.listWalletIds()
    assert.deepEqual(ids, ['7QjUtdhLqh6F84yPRi5D2MmubsYBtyai6YY3WqyPfK64'])
  })

  it('create', function (done) {
    const session = makeSession({needsAccount: true})
    session.server.populate()

    const type = 'wallet:repo:magic'
    const keysJson = {
      magicKey: 'poof'
    }
    assert.equal(session.account.getFirstWallet(type), null)
    session.account.createWallet(type, keysJson, function (err, id) {
      if (err) return done(err)
      const wallet = session.account.getWallet(id)
      assert.equal(wallet.type, type)
      assert.equal(wallet.keys['magicKey'], keysJson.magicKey)
      assert.equal(session.account.listWalletIds().length, 2)
      assert.deepEqual(session.account.getFirstWallet(type), wallet)
      done()
    })
  })
})

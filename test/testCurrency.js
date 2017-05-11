/* global describe, it */
import { makeContext, makeCurrencyWallet, makeFakeIos } from '../src'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

const fakeCurrency = {
  makeEngine () {}
}

describe('currency wallets', function () {
  it('can be created', function () {
    const [io] = makeFakeIos(1)
    const context = makeContext({ io })

    return makeFakeAccount(context, fakeUser).then(account => {
      const keyInfo = account.getFirstWallet('wallet:fakecoin')

      return makeCurrencyWallet(keyInfo, {
        io,
        plugin: fakeCurrency
      }).then(wallet => assert.equal(wallet.id, keyInfo.id))
    })
  })
})

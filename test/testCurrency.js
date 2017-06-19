/* global describe, it */
import { makeContext, makeCurrencyWallet, makeFakeIos } from '../src'
import { makeStore } from '../src/util/derive.js'
import { makeFakeCurrency } from './fake/fakeCurrency.js'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

function makeFakeCurrencyWallet (stores, callbacks) {
  const [io] = makeFakeIos(1)
  const context = makeContext({ io })
  const plugin = makeFakeCurrency(stores)

  return makeFakeAccount(context, fakeUser).then(account => {
    const keyInfo = account.getFirstWallet('wallet:fakecoin')
    const opts = { io: context.io, plugin, callbacks }

    return makeCurrencyWallet(keyInfo, opts)
  })
}

describe('currency wallets', function () {
  it('can be created', function () {
    return makeFakeCurrencyWallet().then(wallet =>
      assert.equal(wallet.name, 'Fake Wallet')
    )
  })

  it('can be renamed', function () {
    return makeFakeCurrencyWallet().then(wallet =>
      wallet
        .renameWallet('Another Name')
        .then(() => assert.equal(wallet.name, 'Another Name'))
    )
  })

  it('triggers callbacks', function () {
    const balance = makeStore(0)
    const blockHeight = makeStore(0)
    const txs = makeStore([])
    const stores = { balance, blockHeight, txs }

    let countBalanceChanged = 0
    let countBlockHeightChanged = 0
    let countTransactionsChanged = 0
    let expectedTxs = []

    function onBalanceChanged (balance) {
      ++countBalanceChanged
      assert.equal(balance, stores.balance())
    }
    function onBlockHeightChanged (blockHeight) {
      ++countBlockHeightChanged
      assert.equal(blockHeight, stores.blockHeight())
    }
    function onTransactionsChanged (txs) {
      ++countTransactionsChanged
      assert.deepEqual(txs, expectedTxs)
    }
    const callbacks = {
      onBalanceChanged,
      onBlockHeightChanged,
      onTransactionsChanged
    }

    return makeFakeCurrencyWallet(stores, callbacks).then(wallet => {
      assert.equal(countBalanceChanged, 1)
      assert.equal(countBlockHeightChanged, 1)
      assert.equal(countTransactionsChanged, 1)

      balance.set(20)
      assert.equal(wallet.getBalance(), 20)
      assert.equal(countBalanceChanged, 2)

      blockHeight.set(200)
      assert.equal(wallet.getBlockHeight(), 200)
      assert.equal(countBlockHeightChanged, 2)

      expectedTxs = [{ txid: 'a' }, { txid: 'b' }]
      txs.set(expectedTxs)
      assert.equal(countTransactionsChanged, 2)

      return null
    })
  })
})

/* global describe, it */
import { makeContext, makeCurrencyWallet, makeFakeIos } from '../src'
import { makeFakeCurrency, makeFakeCurrencyStore } from './fake/fakeCurrency.js'
import { fakeUser, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

function makeFakeCurrencyWallet (store, callbacks) {
  const [io] = makeFakeIos(1)
  const context = makeContext({ io })
  const plugin = makeFakeCurrency(store)

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
    const store = makeFakeCurrencyStore()

    let countBalanceChanged = 0
    let countBlockHeightChanged = 0
    let countNewTransactions = 0
    let countTransactionsChanged = 0
    let expectedTxs = []

    function onBalanceChanged (balance) {
      ++countBalanceChanged
      assert.equal(balance, store.getState().balance)
    }
    function onBlockHeightChanged (blockHeight) {
      ++countBlockHeightChanged
      assert.equal(blockHeight, store.getState().blockHeight)
    }
    function onNewTransactions (txs) {
      ++countNewTransactions
      assert.deepEqual(txs, expectedTxs)
    }
    function onTransactionsChanged (txs) {
      ++countTransactionsChanged
      assert.deepEqual(txs, expectedTxs)
    }
    const callbacks = {
      onBalanceChanged,
      onBlockHeightChanged,
      onNewTransactions,
      onTransactionsChanged
    }

    return makeFakeCurrencyWallet(store, callbacks).then(wallet => {
      let txState = []
      assert.equal(countBalanceChanged, 1)
      assert.equal(countBlockHeightChanged, 1)
      assert.equal(countTransactionsChanged, 0)

      store.dispatch({ type: 'SET_BALANCE', payload: 20 })
      assert.equal(wallet.getBalance(), 20)
      assert.equal(countBalanceChanged, 2)

      store.dispatch({ type: 'SET_BLOCK_HEIGHT', payload: 200 })
      assert.equal(wallet.getBlockHeight(), 200)
      assert.equal(countBlockHeightChanged, 2)

      // New transactions:
      expectedTxs = [
        { txid: 'a', metadata: null },
        { txid: 'b', metadata: null }
      ]
      txState = [...txState, ...expectedTxs]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      assert.equal(countNewTransactions, 1)
      assert.equal(countTransactionsChanged, 0)

      // Should not trigger:
      expectedTxs = []
      txState = [...txState, ...expectedTxs]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      assert.equal(countNewTransactions, 1)
      assert.equal(countTransactionsChanged, 0)

      // Changed transactions:
      expectedTxs = [{ txid: 'a', metadata: 1 }]
      txState = [...txState, ...expectedTxs]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      assert.equal(countNewTransactions, 1)
      assert.equal(countTransactionsChanged, 1)

      return null
    })
  })

  it('can have metadata', function () {
    const store = makeFakeCurrencyStore()

    return makeFakeCurrencyWallet(store).then(wallet => {
      const tx = { txid: 'a', metadata: { name: 'me' } }
      store.dispatch({
        type: 'SET_TXS',
        payload: [{ txid: 'a', signedTx: 'blah' }]
      })
      return wallet
        .saveTx(tx)
        .then(() =>
          wallet
            .getTransactions({})
            .then(txs =>
              assert.deepEqual(txs, [
                { txid: 'a', signedTx: 'blah', metadata: { name: 'me' } }
              ])
            )
        )
    })
  })
})

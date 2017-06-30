/* global describe, it */
import { makeContext, makeCurrencyWallet, makeFakeIos } from '../src'
import { makeAssertLog } from './fake/assertLog.js'
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
    const log = makeAssertLog(true)
    const store = makeFakeCurrencyStore()

    const callbacks = {
      onBalanceChanged: balance => log('balance', balance),
      onBlockHeightChanged: blockHeight => log('blockHeight', blockHeight),
      onNewTransactions: txs => txs.map(tx => log('new', tx.txid)),
      onTransactionsChanged: txs => txs.map(tx => log('changed', tx.txid))
    }
    return makeFakeCurrencyWallet(store, callbacks).then(wallet => {
      let txState = []
      log.assert(['balance 0', 'blockHeight 0'])

      store.dispatch({ type: 'SET_BALANCE', payload: 20 })
      log.assert(['balance 20'])

      store.dispatch({ type: 'SET_BLOCK_HEIGHT', payload: 200 })
      log.assert(['blockHeight 200'])
      assert.equal(wallet.getBlockHeight(), 200)

      // New transactions:
      txState = [{ txid: 'a' }, { txid: 'b' }]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['new a', 'new b'])

      // Should not trigger:
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert([])

      // Changed transactions:
      txState = [...txState, { txid: 'a', metadata: 1 }, { txid: 'c' }]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['changed a', 'new c'])

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

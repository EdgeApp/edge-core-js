/* global describe, it */
import { makeContext, makeCurrencyWallet, makeFakeIos } from '../index.js'
import { makeAssertLog } from '../test/assertLog.js'
import {
  makeFakeCurrency,
  makeFakeCurrencyStore
} from '../test/fakeCurrency.js'
import { fakeExchangePlugin } from '../test/fakeExchange.js'
import { fakeUser, makeFakeAccount } from '../test/fakeUser.js'
import assert from 'assert'

function makeFakeCurrencyWallet (store, callbacks) {
  const [io] = makeFakeIos(1)
  const plugin = makeFakeCurrency(store)

  const context = makeContext({ io, plugins: [plugin, fakeExchangePlugin] })
  return makeFakeAccount(context, fakeUser).then(account => {
    return plugin.makePlugin(io).then(plugin => {
      const keyInfo = account.getFirstWallet('wallet:fakecoin')
      const opts = { io: context.io, plugin, callbacks }

      return makeCurrencyWallet(keyInfo, opts)
    })
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
      onBalanceChanged: (currencyCode, balance) =>
        log('balance', currencyCode, balance),
      onBlockHeightChanged: blockHeight => log('blockHeight', blockHeight),
      onNewTransactions: txids => txids.map(txid => log('new', txid)),
      onTransactionsChanged: txids => txids.map(txid => log('changed', txid))
    }
    return makeFakeCurrencyWallet(store, callbacks).then(wallet => {
      let txState = []
      log.assert(['balance TEST 0', 'blockHeight 0'])

      store.dispatch({ type: 'SET_BALANCE', payload: 20 })
      log.assert(['balance TEST 20'])

      store.dispatch({ type: 'SET_BLOCK_HEIGHT', payload: 200 })
      log.assert(['blockHeight 200'])
      assert.equal(wallet.getBlockHeight(), 200)

      // New transactions:
      txState = [
        { txid: 'a', amountSatoshi: 1 },
        { txid: 'b', nativeAmount: '100' }
      ]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['new a', 'new b'])

      // Should not trigger:
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert([])

      // Changed transactions:
      txState = [
        ...txState,
        { txid: 'a', nativeAmount: '2' },
        { txid: 'c', nativeAmount: '200' }
      ]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['changed a', 'new c'])

      return null
    })
  })

  it('handles tokens', function () {
    const store = makeFakeCurrencyStore()

    return makeFakeCurrencyWallet(store).then(wallet => {
      const txs = [
        { txid: 'a', currencyCode: 'TEST', nativeAmount: '2' },
        { txid: 'b', currencyCode: 'TOKEN', nativeAmount: '200' }
      ]
      store.dispatch({ type: 'SET_TXS', payload: txs })

      return Promise.resolve()
        .then(() =>
          wallet.getTransactions({}).then(txs => {
            assert.equal(txs.length, 1)
            assert.equal(txs[0].txid, 'a')
            assert.strictEqual(txs[0].nativeAmount, '2')
            assert.strictEqual(txs[0].amountSatoshi, 2)
            return null
          })
        )
        .then(() =>
          wallet.getTransactions({ currencyCode: 'TOKEN' }).then(txs => {
            assert.equal(txs.length, 1)
            assert.equal(txs[0].txid, 'b')
            assert.strictEqual(txs[0].nativeAmount, '200')
            assert.strictEqual(txs[0].amountSatoshi, 200)
            return null
          })
        )
    })
  })

  // it('can have metadata', function () {
  //   const store = makeFakeCurrencyStore()
  //
  //   return makeFakeCurrencyWallet(store).then(wallet => {
  //     const tx = { txid: 'a', metadata: { name: 'me' } }
  //     store.dispatch({
  //       type: 'SET_TXS',
  //       payload: [{ txid: 'a', nativeAmount: '25' }]
  //     })
  //     return wallet.saveTx(tx).then(() =>
  //       wallet.getTransactions({}).then(txs => {
  //         assert.equal(txs.length, 1)
  //         assert.strictEqual(txs[0].metadata.name, tx.metadata.name)
  //         assert.strictEqual(txs[0].metadata.amountFiat, 0.75)
  //         assert.strictEqual(txs[0].amountSatoshi, 25)
  //         assert.strictEqual(txs[0].nativeAmount, '25')
  //         return null
  //       })
  //     )
  //   })
  // })
})

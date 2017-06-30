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
      onNewTransactions: txs =>
        txs.map(tx => log('new', tx.txid, tx.nativeAmount)),
      onTransactionsChanged: txs =>
        txs.map(tx => log('changed', tx.txid, tx.nativeAmount))
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
      txState = [
        { txid: 'a', amountSatoshi: 1 },
        { txid: 'b', nativeAmount: '100' }
      ]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['new a 1', 'new b 100'])

      // Should not trigger:
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert([])

      // Changed transactions:
      txState = [
        ...txState,
        { txid: 'a', amountSatoshi: 2 },
        { txid: 'c', nativeAmount: '200' }
      ]
      store.dispatch({ type: 'SET_TXS', payload: txState })
      log.assert(['changed a 2', 'new c 200'])

      return null
    })
  })

  it('can have metadata', function () {
    const store = makeFakeCurrencyStore()

    return makeFakeCurrencyWallet(store).then(wallet => {
      const tx = { txid: 'a', metadata: { name: 'me' } }
      store.dispatch({
        type: 'SET_TXS',
        payload: [{ txid: 'a', nativeAmount: '25' }]
      })
      return wallet
        .saveTx(tx)
        .then(() =>
          wallet
            .getTransactions({})
            .then(txs =>
              assert.deepEqual(txs, [
                {
                  txid: 'a',
                  amountSatoshi: 25,
                  nativeAmount: '25',
                  metadata: { name: 'me' }
                }
              ])
            )
        )
    })
  })
})

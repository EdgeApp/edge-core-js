// @flow

import { add } from 'biggystring'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'
import { createStore } from 'redux'

import { fakeUser, makeFakeContexts } from '../../../../src/edge-core-index.js'
import { awaitState } from '../../../../src/util/redux/reaction.js'
import { makeAssertLog } from '../../../assert-log.js'
import {
  makeFakeCurrency,
  makeFakeCurrencyStore
} from '../../../fake-plugins/fake-currency.js'
import { fakeExchangePlugin } from '../../../fake-plugins/fake-exchange.js'

function snooze (ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function makeFakeCurrencyWallet (store, callbacks) {
  const plugin = makeFakeCurrency(store)

  // Use `onKeyListChanged` to trigger checking for wallets:
  const trigger = createStore(state => null)
  callbacks = {
    ...callbacks,
    onKeyListChanged () {
      trigger.dispatch({ type: 'DUMMY' })
    }
  }

  const [context] = makeFakeContexts({
    localFakeUser: true,
    plugins: [plugin, fakeExchangePlugin]
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin, {
    callbacks
  })

  // Wait for the wallet to load:
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (!walletInfo) throw new Error('Broken test account')
  return awaitState(trigger, state => account.currencyWallets[walletInfo.id])
}

describe('currency wallets', function () {
  it('can be created', function () {
    return makeFakeCurrencyWallet().then(wallet => {
      expect(wallet.name).to.equal('Fake Wallet')
      expect(wallet.displayPrivateSeed).to.equal('xpriv')
      expect(wallet.displayPublicSeed).to.equal('xpub')
    })
  })

  it('can be renamed', function () {
    return makeFakeCurrencyWallet().then(wallet =>
      wallet
        .renameWallet('Another Name')
        .then(() => assert.equal(wallet.name, 'Another Name'))
    )
  })

  it('triggers callbacks', async function () {
    const log = makeAssertLog(true)
    const store = makeFakeCurrencyStore()

    const callbacks = {
      onAddressesChecked (walletId, progress) {
        log('progress', progress)
      },
      onBalanceChanged (walletId, currencyCode, balance) {
        log('balance', currencyCode, balance)
      },
      onBlockHeightChanged (walletId, blockHeight) {
        log('blockHeight', blockHeight)
      },
      onNewTransactions (walletId, txs) {
        txs.map(tx => log('new', tx.txid))
      },
      onTransactionsChanged (walletId, txs) {
        txs.map(tx => log('changed', tx.txid))
      }
    }
    const wallet = await makeFakeCurrencyWallet(store, callbacks)
    let txState = []
    log.assert(['balance TEST 0', 'blockHeight 0', 'progress 0'])
    expect(wallet.balances).to.deep.equal({ TEST: '0', TOKEN: '0' })
    const snoozeTimeMs = 251
    await snooze(snoozeTimeMs)
    log.assert(['balance TOKEN 0'])

    await snooze(snoozeTimeMs)
    store.dispatch({ type: 'SET_TOKEN_BALANCE', payload: 30 })
    log.assert(['balance TOKEN 30'])
    expect(wallet.balances).to.deep.equal({ TEST: '0', TOKEN: '30' })

    store.dispatch({ type: 'SET_BLOCK_HEIGHT', payload: 200 })
    log.assert(['blockHeight 200'])
    assert.equal(wallet.getBlockHeight(), 200)
    expect(wallet.blockHeight).to.equal(200)

    await snooze(snoozeTimeMs)
    store.dispatch({ type: 'SET_PROGRESS', payload: 0.123456789 })
    log.assert(['progress 0.123456789'])

    store.dispatch({ type: 'SET_BALANCE', payload: 1234567890 })
    log.assert(['balance TEST 1234567890'])

    // New transactions:
    txState = [
      { txid: 'a', amountSatoshi: 1 },
      { txid: 'b', nativeAmount: '100' }
    ]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    log.assert(['new a', 'new b'])

    await snooze(snoozeTimeMs)
    // Should not trigger:
    store.dispatch({ type: 'SET_TXS', payload: txState })
    log.assert([])

    await snooze(snoozeTimeMs)
    // Changed transactions:
    txState = [
      ...txState,
      { txid: 'a', nativeAmount: '2' },
      { txid: 'c', nativeAmount: '200' }
    ]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    log.assert(['changed a', 'new c'])

    await snooze(snoozeTimeMs)
    txState = [{ txid: 'd', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    log.assert(['new d'])

    // Make several changes in a row which should get batched into one call due to throttling
    txState = [{ txid: 'e', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    txState = [{ txid: 'f', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    txState = [{ txid: 'g', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    await snooze(snoozeTimeMs)

    log.assert(['new e', 'new f', 'new g'])
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

  it('get max spendable', async function () {
    const store = makeFakeCurrencyStore()
    store.dispatch({ type: 'SET_BALANCE', payload: 50 })

    const wallet = await makeFakeCurrencyWallet(store)
    const maxSpendable = await wallet.getMaxSpendable({
      currencyCode: 'TEST',
      spendTargets: [{}]
    })
    expect(maxSpendable).to.equal('50')

    const fulfill = () => 'FULFILL'
    const reject = () => 'REJECT'

    const fulfilResult = await wallet
      .makeSpend({
        currencyCode: 'TEST',
        spendTargets: [{ nativeAmount: maxSpendable }]
      })
      .then(fulfill, reject)
    expect(fulfilResult).to.equal('FULFILL')

    const rejectResult = await wallet
      .makeSpend({
        currencyCode: 'TEST',
        spendTargets: [{ nativeAmount: add(maxSpendable, '1') }]
      })
      .then(fulfill, reject)
    expect(rejectResult).to.equal('REJECT')
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

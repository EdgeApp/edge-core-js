// @flow

import { add } from 'biggystring'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeCurrencyWallet,
  fakeUser,
  makeFakeContexts
} from '../../../../src/index.js'
import { makeAssertLog } from '../../../assert-log.js'
import { expectRejection } from '../../../expect-rejection.js'
import {
  makeFakeCurrency,
  makeFakeCurrencyStore
} from '../../../fake-plugins/fake-currency.js'
import { fakeExchangePlugin } from '../../../fake-plugins/fake-exchange.js'

function snooze (ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function makeFakeCurrencyWallet (store): Promise<EdgeCurrencyWallet> {
  const plugin = makeFakeCurrency(store)

  const [context] = await makeFakeContexts({
    localFakeUser: true,
    plugins: [plugin, fakeExchangePlugin]
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  // Wait for the wallet to load:
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (!walletInfo) throw new Error('Broken test account')
  return account.waitForCurrencyWallet(walletInfo.id)
}

describe('currency wallets', function () {
  it('can be created', function () {
    return makeFakeCurrencyWallet().then(wallet => {
      expect(wallet.name).equals('Fake Wallet')
      expect(wallet.displayPrivateSeed).equals('xpriv')
      expect(wallet.displayPublicSeed).equals('xpub')
    })
  })

  it('can be renamed', async function () {
    const log = makeAssertLog()
    const wallet = await makeFakeCurrencyWallet()
    wallet.watch('name', name => log(name))

    await wallet.renameWallet('Another Name')
    assert.equal(wallet.name, 'Another Name')
    log.assert(['Another Name'])
  })

  it('triggers callbacks', async function () {
    const watchSnooze = 10
    const throttleSnooze = 30
    const log = makeAssertLog(true)
    const store = makeFakeCurrencyStore()

    // Subscribe to the wallet:
    const wallet: EdgeCurrencyWallet = await makeFakeCurrencyWallet(store)
    wallet.on('newTransactions', txs => txs.map(tx => log('new', tx.txid)))
    wallet.on('transactionsChanged', txs =>
      txs.map(tx => log('changed', tx.txid))
    )
    wallet.watch('balances', balances =>
      log('balances', JSON.stringify(balances).replace(/"/g, ''))
    )
    wallet.watch('blockHeight', blockHeight => log('blockHeight', blockHeight))
    wallet.watch('syncRatio', syncRatio => log('syncRatio', syncRatio))

    // Test property watchers:
    let txState = []
    log.assert([])
    expect(wallet.balances).to.deep.equal({ TEST: '0', TOKEN: '0' })

    store.dispatch({ type: 'SET_TOKEN_BALANCE', payload: 30 })
    await snooze(watchSnooze)
    log.assert(['balances {TEST:0,TOKEN:30}'])
    expect(wallet.balances).to.deep.equal({ TEST: '0', TOKEN: '30' })

    store.dispatch({ type: 'SET_BLOCK_HEIGHT', payload: 200 })
    await snooze(watchSnooze)
    log.assert(['blockHeight 200'])
    assert.equal(wallet.getBlockHeight(), 200)
    expect(wallet.blockHeight).to.equal(200)

    store.dispatch({ type: 'SET_PROGRESS', payload: 0.123456789 })
    await snooze(watchSnooze)
    expect(wallet.syncRatio).to.equal(0.123456789)
    log.assert(['syncRatio 0.123456789'])

    store.dispatch({ type: 'SET_BALANCE', payload: 1234567890 })
    await snooze(watchSnooze)
    log.assert(['balances {TEST:1234567890,TOKEN:30}'])

    // New transactions:
    txState = [
      { txid: 'a', amountSatoshi: 1 },
      { txid: 'b', nativeAmount: '100' }
    ]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    await snooze(throttleSnooze)
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
    await snooze(throttleSnooze)
    log.assert(['changed a', 'new c'])

    txState = [{ txid: 'd', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    await snooze(throttleSnooze)
    log.assert(['new d'])

    // Make several changes in a row which should get batched into one call due to throttling
    txState = [{ txid: 'e', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    txState = [{ txid: 'f', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    txState = [{ txid: 'g', nativeAmount: '200' }]
    store.dispatch({ type: 'SET_TXS', payload: txState })
    await snooze(throttleSnooze)
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
            // $FlowFixMe legacy support code
            assert.strictEqual(txs[0].amountSatoshi, 2)
            return null
          })
        )
        .then(() =>
          wallet.getTransactions({ currencyCode: 'TOKEN' }).then(txs => {
            assert.equal(txs.length, 1)
            assert.equal(txs[0].txid, 'b')
            assert.strictEqual(txs[0].nativeAmount, '200')
            // $FlowFixMe legacy support code
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
    expect(maxSpendable).equals('50')

    await wallet.makeSpend({
      currencyCode: 'TEST',
      spendTargets: [{ nativeAmount: maxSpendable }]
    })

    await expectRejection(
      wallet.makeSpend({
        currencyCode: 'TEST',
        spendTargets: [{ nativeAmount: add(maxSpendable, '1') }]
      }),
      'InsufficientFundsError: Insufficient funds'
    )
  })

  it('converts number formats', async function () {
    const wallet: EdgeCurrencyWallet = await makeFakeCurrencyWallet()
    expect(await wallet.denominationToNative('0.1', 'SMALL')).equals('1')
    expect(await wallet.denominationToNative('0.1', 'TEST')).equals('10')
    expect(await wallet.denominationToNative('0.1', 'TOKEN')).equals('100')
    expect(await wallet.nativeToDenomination('10', 'SMALL')).equals('1')
    expect(await wallet.nativeToDenomination('10', 'TEST')).equals('0.1')
    expect(await wallet.nativeToDenomination('10', 'TOKEN')).equals('0.01')
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

// @flow

import { add } from 'biggystring'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'
import { createStore } from 'redux'

import type { EdgeTransaction } from '../../../edge-core-index'
import { fakeUser, makeFakeContexts } from '../../../edge-core-index'
import {
  makeFakeCurrency,
  makeFakeCurrencyStore
} from '../../../fake-plugins/fakeCurrency.js'
import { fakeExchangePlugin } from '../../../fake-plugins/fakeExchange.js'
import { makeAssertLog } from '../../../util/assertLog.js'
import { awaitState } from '../../../util/redux/reaction.js'
import {
  exportTransactionsToCSVInner,
  exportTransactionsToQBOInner
} from './currency-wallet-api'

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
    return makeFakeCurrencyWallet(store, callbacks).then(wallet => {
      let txState = []
      log.assert([
        'balance TEST 0',
        'balance TOKEN 0',
        'blockHeight 0',
        'progress 0'
      ])

      store.dispatch({ type: 'SET_PROGRESS', payload: 0.5 })
      log.assert(['progress 0.5'])

      store.dispatch({ type: 'SET_BALANCE', payload: 20 })
      log.assert(['balance TEST 20'])

      store.dispatch({ type: 'SET_TOKEN_BALANCE', payload: 30 })
      log.assert(['balance TOKEN 30'])

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

      return setTimeout(() => {
        // Should not trigger:
        store.dispatch({ type: 'SET_TXS', payload: txState })
        log.assert([])

        return setTimeout(() => {
          // Changed transactions:
          txState = [
            ...txState,
            { txid: 'a', nativeAmount: '2' },
            { txid: 'c', nativeAmount: '200' }
          ]
          store.dispatch({ type: 'SET_TXS', payload: txState })
          log.assert(['changed a', 'new c'])

          return setTimeout(() => {
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
            setTimeout(() => {
              log.assert(['new e', 'new f', 'new g'])
            }, 251)
          }, 251)
        }, 251)
      }, 251)
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

  const edgeTxs: Array<EdgeTransaction> = [
    {
      txid: 'txid1',
      date: 1524476980,
      currencyCode: 'BTC',
      blockHeight: 500000,
      nativeAmount: '123000000',
      networkFee: '1000',
      ourReceiveAddresses: ['receiveaddress1', 'receiveaddress2'],
      signedTx: '298t983y4t983y4t93y4g98oeshfgi4t89w394t',
      parentNetworkFee: '10002',
      metadata: {
        name: 'Crazy Person',
        category: 'Income: Mo Money',
        notes: 'Hell yeah! Thanks for the fish',
        amountFiat: 12000.45
      },
      otherParams: null
    },
    {
      txid: 'txid2',
      date: 1524486980,
      currencyCode: 'BTC',
      blockHeight: 500000,
      nativeAmount: '-321000000',
      networkFee: '2000',
      ourReceiveAddresses: ['receiveaddress3', 'receiveaddress4'],
      signedTx: 'fiuwh34f98h3tiuheirgserg',
      parentNetworkFee: '20001',
      metadata: {
        name: 'Crazy Person 2',
        category: 'Expense: Less Money',
        notes: 'Hell yeah! Here\'s a fish"',
        amountFiat: 36001.45
      },
      otherParams: null
    }
  ]

  it('Export CSV', async function () {
    const out = await exportTransactionsToCSVInner(edgeTxs, 'BTC', 'USD', 100)
    expect(out).to.equal(
      `DATE,TIME,PAYEE_PAYER_NAME,AMT_BTC,USD,CATEGORY,NOTES,AMT_NETWORK_FEES_BTC,TXID,OUR_RECEIVE_ADDRESSES,VER\r\n"2018-04-23","09:49","Crazy Person","1230000","12000.45","Income: Mo Money","Hell yeah! Thanks for the fish","10","txid1","receiveaddress1,receiveaddress2",1\r\n"2018-04-23","12:36","Crazy Person 2","-3210000","36001.45","Expense: Less Money","Hell yeah! Here's a fish""","20","txid2","receiveaddress3,receiveaddress4",1\r\n`
    )
  })

  it('Export QBO', function () {
    const out = exportTransactionsToQBOInner(
      edgeTxs,
      'BTC',
      'USD',
      100,
      1524578071304
    )
    expect(out).to.equal(
      'OFXHEADER:100\n' +
        'DATA:OFXSGML\n' +
        'VERSION:102\n' +
        'SECURITY:NONE\n' +
        'ENCODING:USASCII\n' +
        'CHARSET:1252\n' +
        'COMPRESSION:NONE\n' +
        'OLDFILEUID:NONE\n' +
        'NEWFILEUID:NONE\n' +
        '\n' +
        '<OFX>\n' +
        '<SIGNONMSGSRSV1>\n' +
        '<SONRS>\n' +
        '<STATUS>\n' +
        '<CODE>0\n' +
        '<SEVERITY>INFO\n' +
        '</STATUS>\n' +
        '<DTSERVER>20180424135431.000\n' +
        '<LANGUAGE>ENG\n' +
        '<INTU.BID>3000\n' +
        '</SONRS>\n' +
        '</SIGNONMSGSRSV1>\n' +
        '<BANKMSGSRSV1>\n' +
        '<STMTTRNRS>\n' +
        '<TRNUID>20180424135431.000\n' +
        '<STATUS>\n' +
        '<CODE>0\n' +
        '<SEVERITY>INFO\n' +
        '<MESSAGE>OK\n' +
        '</STATUS>\n' +
        '<STMTRS>\n' +
        '<CURDEF>USD\n' +
        '<BANKACCTFROM>\n' +
        '<BANKID>999999999\n' +
        '<ACCTID>999999999999\n' +
        '<ACCTTYPE>CHECKING\n' +
        '</BANKACCTFROM>\n' +
        '<BANKTRANLIST>\n' +
        '<DTSTART>20180424135431.000\n' +
        '<DTEND>20180424135431.000\n' +
        '<STMTTRN>\n' +
        '<TRNTYPE>CREDIT\n' +
        '<DTPOSTED>20180423094940.000\n' +
        '<TRNAMT>1230000\n' +
        '<FITID>txid1\n' +
        '<NAME>Crazy Person\n' +
        '<MEMO>// Rate=0.00975646 USD=12000.45 category="Income: Mo Money" memo="Hell yeah! Thanks for the fish"\n' +
        '<CURRENCY>\n' +
        '<CURRATE>\n' +
        '<CURSYM>USD\n' +
        '</CURRENCY>\n' +
        '</STMTTRN>\n' +
        '<STMTTRN>\n' +
        '<TRNTYPE>DEBIT\n' +
        '<DTPOSTED>20180423123620.000\n' +
        '<TRNAMT>-3210000\n' +
        '<FITID>txid2\n' +
        '<NAME>Crazy Person 2\n' +
        '<MEMO>// Rate=0.0112154 USD=36001.45 category="Expense: Less Money" memo="Hell yeah! Here\'s a fish""\n' +
        '<CURRENCY>\n' +
        '<CURRATE>\n' +
        '<CURSYM>USD\n' +
        '</CURRENCY>\n' +
        '</STMTTRN>\n' +
        '</BANKTRANLIST>\n' +
        '<LEDGERBAL>\n' +
        '<BALAMT>0.00\n' +
        '<DTASOF>20180424135431.000\n' +
        '</LEDGERBAL>\n' +
        '<AVAILBAL>\n' +
        '<BALAMT>0.00\n' +
        '<DTASOF>20180424135431.000\n' +
        '</AVAILBAL>\n' +
        '</STMTRS>\n' +
        '</STMTTRNRS>\n' +
        '</BANKMSGSRSV1>\n' +
        '</OFX>\n'
    )
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

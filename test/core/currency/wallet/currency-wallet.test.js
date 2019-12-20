// @flow

import { makeAssertLog } from 'assert-log'
import { add } from 'biggystring'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeCurrencyConfig,
  type EdgeCurrencyWallet,
  makeFakeEdgeWorld
} from '../../../../src/index.js'
import { expectRejection } from '../../../expect-rejection.js'
import { fakeUser } from '../../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

async function makeFakeCurrencyWallet(): Promise<
  [EdgeCurrencyWallet, EdgeCurrencyConfig]
> {
  const world = await makeFakeEdgeWorld([fakeUser])
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { fakecoin: true, 'fake-exchange': true }
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

  // Wait for the wallet to load:
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)
  const config = account.currencyConfig.fakecoin
  return [wallet, config]
}

describe('currency wallets', function() {
  it('can be created', async function() {
    const [wallet] = await makeFakeCurrencyWallet()
    expect(wallet.name).equals('Fake Wallet')
    expect(wallet.displayPrivateSeed).equals('xpriv')
    expect(wallet.displayPublicSeed).equals('xpub')
  })

  it('can be renamed', async function() {
    const log = makeAssertLog()
    const [wallet] = await makeFakeCurrencyWallet()
    wallet.watch('name', name => log(name))

    await wallet.renameWallet('Another Name')
    assert.equal(wallet.name, 'Another Name')
    log.assert('Another Name')
  })

  it('has publicWalletInfo', async function() {
    const [wallet] = await makeFakeCurrencyWallet()
    expect(wallet.publicWalletInfo).deep.equals({
      id: 'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=',
      keys: { fakeAddress: 'FakePublicAddress' },
      type: 'wallet:fakecoin'
    })
  })

  it('triggers callbacks', async function() {
    const log = makeAssertLog()
    const [wallet, config] = await makeFakeCurrencyWallet()

    // Subscribe to the wallet:
    wallet.on('newTransactions', txs => {
      log('new', txs.map(tx => tx.txid).join(' '))
    })
    wallet.on('transactionsChanged', txs => {
      log('changed', txs.map(tx => tx.txid).join(' '))
    })
    wallet.watch('balances', balances => {
      log('balances', balances)
    })
    wallet.watch('blockHeight', blockHeight => {
      log('blockHeight', blockHeight)
    })
    wallet.watch('syncRatio', syncRatio => {
      log('syncRatio', syncRatio)
    })

    // Test property watchers:
    log.assert()
    expect(wallet.balances).to.deep.equal({ FAKE: '0', TOKEN: '0' })

    await config.changeUserSettings({ tokenBalance: 30 })
    await log.waitFor(1).assert('balances { FAKE: "0", TOKEN: "30" }')
    expect(wallet.balances).to.deep.equal({ FAKE: '0', TOKEN: '30' })

    await config.changeUserSettings({ blockHeight: 200 })
    await log.waitFor(1).assert('blockHeight 200')
    expect(wallet.blockHeight).to.equal(200)
    assert.equal(wallet.getBlockHeight(), 200)

    await config.changeUserSettings({ progress: 0.123456789 })
    await log.waitFor(1).assert('syncRatio 0.123456789')
    expect(wallet.syncRatio).to.equal(0.123456789)

    await config.changeUserSettings({ balance: 1234567890 })
    await log.waitFor(1).assert('balances { FAKE: "1234567890", TOKEN: "30" }')
    expect(wallet.balances).to.deep.equal({ FAKE: '1234567890', TOKEN: '30' })

    // New transactions:
    await config.changeUserSettings({
      txs: {
        a: { amountSatoshi: 1 },
        b: { nativeAmount: '100' }
      }
    })
    log.assert('new a b')

    // Should not trigger:
    await config.changeUserSettings({ txs: {} })
    log.assert()

    // Changed transactions:
    await config.changeUserSettings({
      txs: {
        a: { nativeAmount: '2' },
        c: { nativeAmount: '200' }
      }
    })
    await log.waitFor(2).assert('changed a', 'new c')

    // New transaction:
    await config.changeUserSettings({ txs: { d: { nativeAmount: '200' } } })
    await log.waitFor(1).assert('new d')

    // Changes should be batched due to throttling:
    await config.changeUserSettings({ txs: { e: { nativeAmount: '200' } } })
    await config.changeUserSettings({ txs: { f: { nativeAmount: '200' } } })
    await config.changeUserSettings({ txs: { g: { nativeAmount: '200' } } })
    await log.waitFor(1).assert('new e f g')
  })

  it('handles tokens', async function() {
    const [wallet, config] = await makeFakeCurrencyWallet()
    await config.changeUserSettings({
      txs: {
        a: { currencyCode: 'FAKE', nativeAmount: '2' },
        b: { currencyCode: 'TOKEN', nativeAmount: '200' }
      }
    })

    await wallet.getTransactions({}).then(txs => {
      assert.equal(txs.length, 1)
      assert.equal(txs[0].txid, 'a')
      assert.strictEqual(txs[0].nativeAmount, '2')
      // $FlowFixMe legacy support code
      assert.strictEqual(txs[0].amountSatoshi, 2)
    })

    await wallet.getTransactions({ currencyCode: 'TOKEN' }).then(txs => {
      assert.equal(txs.length, 1)
      assert.equal(txs[0].txid, 'b')
      assert.strictEqual(txs[0].nativeAmount, '200')
      // $FlowFixMe legacy support code
      assert.strictEqual(txs[0].amountSatoshi, 200)
    })
  })

  it('get max spendable', async function() {
    const [wallet, config] = await makeFakeCurrencyWallet()
    await config.changeUserSettings({ balance: 50 })

    const maxSpendable = await wallet.getMaxSpendable({
      currencyCode: 'FAKE',
      spendTargets: [{}]
    })
    expect(maxSpendable).equals('50')

    await wallet.makeSpend({
      currencyCode: 'FAKE',
      spendTargets: [{ nativeAmount: maxSpendable }]
    })

    await expectRejection(
      wallet.makeSpend({
        currencyCode: 'FAKE',
        spendTargets: [{ nativeAmount: add(maxSpendable, '1') }]
      }),
      'InsufficientFundsError: Insufficient funds'
    )
  })

  it('converts number formats', async function() {
    const [wallet] = await makeFakeCurrencyWallet()
    expect(await wallet.denominationToNative('0.1', 'SMALL')).equals('1')
    expect(await wallet.denominationToNative('0.1', 'FAKE')).equals('10')
    expect(await wallet.denominationToNative('0.1', 'TOKEN')).equals('100')
    expect(await wallet.nativeToDenomination('10', 'SMALL')).equals('1')
    expect(await wallet.nativeToDenomination('10', 'FAKE')).equals('0.1')
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

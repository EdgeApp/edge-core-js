// @flow

import { makeAssertLog } from 'assert-log'
import { add } from 'biggystring'
import { assert, expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeContext,
  type EdgeCurrencyConfig,
  type EdgeCurrencyWallet,
  type EdgeMetadata,
  type EdgeTxSwap,
  makeFakeEdgeWorld
} from '../../../../src/index.js'
import { expectRejection } from '../../../expect-rejection.js'
import { walletTxs } from '../../../fake/fake-transactions.js'
import { fakeUser } from '../../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '', deviceDescription: 'iphone12' }
const quiet = { onLog() {} }

async function makeFakeCurrencyWallet(
  pauseWallets?: boolean
): Promise<{
  config: EdgeCurrencyConfig,
  context: EdgeContext,
  wallet: EdgeCurrencyWallet
}> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { fakecoin: true, 'fake-exchange': true }
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin, {
    pauseWallets
  })

  // Wait for the wallet to load:
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)
  const config = account.currencyConfig.fakecoin
  return { config, context, wallet }
}

describe('currency wallets', function () {
  it('can be created', async function () {
    const { wallet } = await makeFakeCurrencyWallet()
    expect(wallet.name).equals('Fake Wallet')
    expect(wallet.displayPrivateSeed).equals('xpriv')
    expect(wallet.displayPublicSeed).equals('xpub')
    expect(wallet.paused).equals(false)
  })

  it('can be renamed', async function () {
    const log = makeAssertLog()
    const { wallet } = await makeFakeCurrencyWallet()
    wallet.watch('name', name => log(name))

    await wallet.renameWallet('Another Name')
    assert.equal(wallet.name, 'Another Name')
    log.assert('Another Name')
  })

  it('has publicWalletInfo', async function () {
    const { wallet } = await makeFakeCurrencyWallet()
    expect(wallet.publicWalletInfo).deep.equals({
      id: 'narfavJN4rp9ZzYigcRj1i0vrU2OAGGp4+KksAksj54=',
      keys: { fakeAddress: 'FakePublicAddress' },
      type: 'wallet:fakecoin'
    })
  })

  it('triggers callbacks', async function () {
    const log = makeAssertLog()
    const { wallet, config } = await makeFakeCurrencyWallet()

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

  it('handles tokens', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
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

  it('search transactions', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
    await config.changeUserSettings({
      txs: walletTxs
    })

    await wallet.getTransactions({ currencyCode: 'BTC' }).then(txs => {
      assert.equal(txs.length, 13)
      assert.equal(txs[0].txid, 'a')
      assert.strictEqual(txs[0].nativeAmount, '644350')
    })

    await wallet
      .getTransactions({ currencyCode: 'BTC', searchString: 'sideshift' })
      .then(txs => {
        assert.equal(txs.length, 3)
        assert.equal(txs[0].txid, 'k')
        assert.strictEqual(txs[0].nativeAmount, '-371258')
      })

    await wallet
      .getTransactions({
        currencyCode: 'BTC',
        startDate: new Date(1199145601000),
        endDate: new Date(1612546887000)
      })
      .then(txs => {
        assert.equal(txs.length, 8)
        assert.equal(txs[0].txid, 'f')
        assert.strictEqual(txs[0].nativeAmount, '-3300')
      })
  })

  it('get max spendable', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
    await config.changeUserSettings({ balance: 50 })

    const maxSpendable = await wallet.getMaxSpendable({
      currencyCode: 'FAKE',
      spendTargets: [{}]
    })
    expect(maxSpendable).equals('50')

    await wallet.makeSpend({
      currencyCode: 'FAKE',
      spendTargets: [
        {
          nativeAmount: maxSpendable,
          publicAddress: 'somewhere'
        }
      ]
    })

    await expectRejection(
      wallet.makeSpend({
        currencyCode: 'FAKE',
        spendTargets: [
          {
            nativeAmount: add(maxSpendable, '1'),
            publicAddress: 'somewhere'
          }
        ]
      }),
      'InsufficientFundsError: Insufficient funds'
    )
  })

  it('converts number formats', async function () {
    const { wallet } = await makeFakeCurrencyWallet()
    expect(await wallet.denominationToNative('0.1', 'SMALL')).equals('1')
    expect(await wallet.denominationToNative('0.1', 'FAKE')).equals('10')
    expect(await wallet.denominationToNative('0.1', 'TOKEN')).equals('100')
    expect(await wallet.nativeToDenomination('10', 'SMALL')).equals('1')
    expect(await wallet.nativeToDenomination('10', 'FAKE')).equals('0.1')
    expect(await wallet.nativeToDenomination('10', 'TOKEN')).equals('0.01')
  })

  it('can save metadata at spend time', async function () {
    const log = makeAssertLog()
    const { wallet, config } = await makeFakeCurrencyWallet()
    await config.changeUserSettings({ balance: 100 }) // Spending balance

    // Subscribe to new transactions:
    wallet.on('newTransactions', txs => {
      const { txid, metadata = {} } = tx
      const { name = '' } = metadata
      log('new', txs.map(tx => `${txid} ${name}`).join(' '))
    })

    // Perform the spend:
    const metadata: EdgeMetadata = { name: 'me' }
    const swapData: EdgeTxSwap = {
      orderId: '1234',
      isEstimate: true,
      plugin: {
        pluginId: 'fakeswap',
        displayName: 'Fake Swap',
        supportEmail: undefined
      },
      payoutAddress: 'get it here',
      payoutCurrencyCode: 'TOKEN',
      payoutNativeAmount: '1',
      payoutWalletId: wallet.id
    }
    let tx = await wallet.makeSpend({
      currencyCode: 'FAKE',
      spendTargets: [
        {
          nativeAmount: '50',
          publicAddress: 'somewhere'
        }
      ],
      metadata,
      swapData,
      networkFeeOption: 'high'
    })
    tx = await wallet.signTx(tx)
    await wallet.broadcastTx(tx)
    await wallet.saveTx(tx)

    // Validate the result:
    await log.waitFor(1).assert('new spend me')
    const txs = await wallet.getTransactions({})
    expect(txs.length).equals(1)
    expect(txs[0].nativeAmount).equals('50')
    expect(txs[0].metadata).deep.equals({
      bizId: undefined,
      category: undefined,
      notes: undefined,
      exchangeAmount: { 'iso:USD': 1.5 },
      amountFiat: 1.5,
      ...metadata
    })
    expect(txs[0].networkFeeOption).equals('high')
    expect(txs[0].feeRateUsed).deep.equals({ fakePrice: 0 })
    expect(txs[0].spendTargets).deep.equals([
      {
        currencyCode: 'FAKE',
        nativeAmount: '50',
        publicAddress: 'somewhere',
        uniqueIdentifier: undefined
      }
    ])
    expect(txs[0].swapData).deep.equals({
      orderUri: undefined,
      refundAddress: undefined,
      ...swapData
    })
    expect(txs[0].txSecret).equals('open sesame')
    expect(txs[0].deviceDescription).equals('iphone12')
  })

  it('can update metadata', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()

    const metadata: EdgeMetadata = {
      name: 'me',
      amountFiat: 0.75
    }
    await config.changeUserSettings({ txs: { a: { nativeAmount: '25' } } })
    await wallet.saveTxMetadata('a', 'FAKE', metadata)

    const txs = await wallet.getTransactions({})
    expect(txs.length).equals(1)
    expect(txs[0].nativeAmount).equals('25')
    expect(txs[0].metadata).deep.equals({
      bizId: undefined,
      category: undefined,
      notes: undefined,
      exchangeAmount: { 'iso:USD': 0.75 },
      ...metadata
    })
  })

  it('can be paused and un-paused', async function () {
    const { wallet, context } = await makeFakeCurrencyWallet(true)
    const isEngineRunning = async () => {
      const dump = await wallet.dumpData()
      return dump.data.fakeEngine.running
    }

    // We should start paused:
    expect(wallet.paused).equals(true)
    expect(await isEngineRunning()).equals(false)

    // Unpausing should start the engine:
    await wallet.changePaused(false)
    expect(wallet.paused).equals(false)
    expect(await isEngineRunning()).equals(true)

    // Pausing should stop the engine:
    await wallet.changePaused(true)
    expect(wallet.paused).equals(true)
    expect(await isEngineRunning()).equals(false)

    // Pausing the context should keep the engine off:
    await context.changePaused(true)
    await wallet.changePaused(false)
    expect(wallet.paused).equals(false)
    expect(await isEngineRunning()).equals(false)
  })
})

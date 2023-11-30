import { makeAssertLog } from 'assert-log'
import { add } from 'biggystring'
import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  EdgeAccount,
  EdgeContext,
  EdgeCurrencyConfig,
  EdgeCurrencyWallet,
  EdgeMetadata,
  EdgeToken,
  EdgeTransaction,
  EdgeTxAction,
  EdgeTxSwap,
  makeFakeEdgeWorld
} from '../../../../src/index'
import { expectRejection } from '../../../expect-rejection'
import { walletTxs } from '../../../fake/fake-transactions'
import { fakeUser } from '../../../fake/fake-user'

const contextOptions = { apiKey: '', appId: '', deviceDescription: 'iphone12' }
const quiet = { onLog() {} }

interface Fixture {
  account: EdgeAccount
  config: EdgeCurrencyConfig
  context: EdgeContext
  wallet: EdgeCurrencyWallet
}

async function makeFakeCurrencyWallet(
  pauseWallets?: boolean
): Promise<Fixture> {
  const world = await makeFakeEdgeWorld([fakeUser], quiet)
  const context = await world.makeEdgeContext({
    ...contextOptions,
    plugins: { 'broken-engine': true, 'fake-exchange': true, fakecoin: true }
  })
  const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin, {
    pauseWallets
  })

  // Wait for the wallet to load:
  const walletInfo = account.getFirstWalletInfo('wallet:fakecoin')
  if (walletInfo == null) throw new Error('Broken test account')
  const wallet = await account.waitForCurrencyWallet(walletInfo.id)
  const config = account.currencyConfig.fakecoin
  return { account, config, context, wallet }
}

describe('currency wallets', function () {
  it('can be created', async function () {
    const { account, wallet } = await makeFakeCurrencyWallet()
    expect(wallet.name).equals('Fake Wallet')
    expect(wallet.paused).equals(false)
    expect(await account.getDisplayPrivateKey(wallet.id)).equals('xpriv')
    expect(await account.getDisplayPublicKey(wallet.id)).equals('xpub')
  })

  it('can be renamed', async function () {
    const log = makeAssertLog()
    const { wallet } = await makeFakeCurrencyWallet()
    wallet.watch('name', name => log(name))

    await wallet.renameWallet('Another Name')
    expect(wallet.name).equals('Another Name')
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

  it('has the right currencyConfig object', async function () {
    const { account, wallet } = await makeFakeCurrencyWallet()
    expect(account.currencyConfig.fakecoin).equals(wallet.currencyConfig)
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
    wallet.watch('stakingStatus', stakingStatus => {
      log('stakingStatus', stakingStatus.stakedAmounts[0].nativeAmount)
    })
    wallet.watch('syncRatio', syncRatio => {
      log('syncRatio', syncRatio)
    })

    // Test property watchers:
    log.assert()
    expect(wallet.balances).to.deep.equal({ FAKE: '0', TOKEN: '0' })
    expect(wallet.stakingStatus).deep.equals({
      stakedAmounts: [{ nativeAmount: '0' }]
    })

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

    await config.changeUserSettings({ stakedBalance: 543 })
    await log.waitFor(1).assert('stakingStatus 543')
    expect(wallet.stakingStatus).deep.equals({
      stakedAmounts: [{ nativeAmount: '543' }]
    })

    // New transactions:
    await config.changeUserSettings({
      txs: {
        a: { nativeAmount: '1' },
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

  it('handles token balances', async function () {
    const fixture: Fixture = await makeFakeCurrencyWallet()
    const { wallet, config } = fixture
    await config.changeUserSettings({
      txs: {
        a: { currencyCode: 'FAKE', nativeAmount: '2', tokenId: null },
        b: {
          currencyCode: 'TOKEN',
          nativeAmount: '200',
          tokenId:
            'f98103e9217f099208569d295c1b276f1821348636c268c854bb2a086e0037cd'
        }
      }
    })

    await wallet.getTransactions({}).then(txs => {
      expect(txs.length).equals(1)
      expect(txs[0].txid).equals('a')
      expect(txs[0].nativeAmount).equals('2')
    })

    await wallet.getTransactions({ currencyCode: 'TOKEN' }).then(txs => {
      expect(txs.length).equals(1)
      expect(txs[0].txid).equals('b')
      expect(txs[0].nativeAmount).equals('200')
    })
  })

  it('exposes builtin tokens', async function () {
    const { config } = await makeFakeCurrencyWallet()

    expect(config.builtinTokens).deep.equals({
      f98103e9217f099208569d295c1b276f1821348636c268c854bb2a086e0037cd: {
        currencyCode: 'TOKEN',
        displayName: 'Fake Token',
        denominations: [{ multiplier: '1000', name: 'TOKEN' }],
        networkLocation: {
          contractAddress:
            '0XF98103E9217F099208569D295C1B276F1821348636C268C854BB2A086E0037CD'
        }
      }
    })
  })

  it('exposes custom tokens', async function () {
    const log = makeAssertLog()
    const { config } = await makeFakeCurrencyWallet()

    config.watch('customTokens', () => log('customTokens changed'))
    expect(config.customTokens).deep.equals({})

    const customToken: EdgeToken = {
      currencyCode: 'CUSTOM',
      displayName: 'Custom Token',
      denominations: [{ multiplier: '1000', name: 'CUSTOM' }],
      networkLocation: {
        contractAddress:
          '0X7CD5885327FD60E825D67D32F9D22B018227A208AA3C4819DA15B36B5D5869D3'
      }
    }

    await config.addCustomToken(customToken)
    log.assert('customTokens changed')
    expect(config.customTokens).deep.equals({
      '7cd5885327fd60e825d67d32f9d22b018227a208aa3c4819da15b36b5d5869d3':
        customToken
    })

    expect(config.allTokens).deep.equals({
      ...config.customTokens,
      ...config.builtinTokens
    })
  })

  it('enables tokens', async function () {
    const log = makeAssertLog()
    const { wallet } = await makeFakeCurrencyWallet()
    const tokenId =
      'f98103e9217f099208569d295c1b276f1821348636c268c854bb2a086e0037cd'

    wallet.watch('enabledTokenIds', ids => log(ids.join(', ')))
    expect(wallet.enabledTokenIds).deep.equals([])

    await wallet.changeEnabledTokenIds([tokenId])
    expect(wallet.enabledTokenIds).deep.equals([tokenId])
    log.assert(tokenId)

    // Missing token:
    await wallet.changeEnabledTokenIds([tokenId, 'nope'])
    expect(wallet.enabledTokenIds).deep.equals([tokenId])
  })

  it('supports always-enabled tokens', async function () {
    const log = makeAssertLog()
    const { config } = await makeFakeCurrencyWallet()
    const tokenId =
      'f98103e9217f099208569d295c1b276f1821348636c268c854bb2a086e0037cd'

    config.watch('alwaysEnabledTokenIds', ids => log(ids.join(', ')))
    expect(config.alwaysEnabledTokenIds).deep.equals([])

    // Change the config object:
    await config.changeAlwaysEnabledTokenIds([tokenId])
    expect(config.alwaysEnabledTokenIds).deep.equals([tokenId])
    log.assert(tokenId)
  })

  it('paginates transactions', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
    await addDemoTransactions(config)

    // Normal behavior:
    expect(
      justTxids(
        await wallet.getTransactions({
          currencyCode: 'BTC',
          startIndex: 3,
          startEntries: 2
        })
      )
    ).deep.equals(['d', 'e'])

    expect(
      justTxids(
        await wallet.getTransactions({
          currencyCode: 'BTC',
          searchString: 'sideshift',
          startIndex: 2,
          startEntries: 2
        })
      )
    ).deep.equals(['k', 'l'])
  })

  it('streams transactions', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
    const tokenId = await addDemoTransactions(config)

    // Normal behavior:
    const stream = wallet.streamTransactions({
      batchSize: 2,
      firstBatchSize: 3,
      tokenId
    })
    checkIteratorResult(await stream.next(), ['a', 'b', 'c'])
    checkIteratorResult(await stream.next(), ['d', 'e'])
    checkIteratorResult(await stream.next(), ['f', 'g'])
    checkIteratorResult(await stream.next(), ['h', 'i'])
    checkIteratorResult(await stream.next(), ['j', 'k'])
    checkIteratorResult(await stream.next(), ['l', 'm'])
    checkIteratorResult(await stream.next())

    // Searching:
    const search = wallet.streamTransactions({
      batchSize: 2,
      searchString: 'sideshift',
      tokenId
    })
    checkIteratorResult(await search.next(), ['k', 'l'])
    checkIteratorResult(await search.next(), ['m'])
    checkIteratorResult(await search.next())
  })

  it('search transactions', async function () {
    const { wallet, config } = await makeFakeCurrencyWallet()
    await addDemoTransactions(config)

    expect(
      justTxids(
        await wallet.getTransactions({
          currencyCode: 'BTC'
        })
      )
    ).deep.equals([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
      'm'
    ])

    expect(
      justTxids(
        await wallet.getTransactions({
          currencyCode: 'BTC',
          searchString: 'sideshift'
        })
      )
    ).deep.equals(['k', 'l', 'm'])

    expect(
      justTxids(
        await wallet.getTransactions({
          currencyCode: 'BTC',
          startDate: new Date('2021-01-30'),
          endDate: new Date('2021-02-05')
        })
      )
    ).deep.equals(['g', 'h', 'i', 'j', 'k'])
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
    wallet.on('newTransactions', () => log('bad'))
    wallet.on('transactionsChanged', txs => {
      const { txid, metadata = {} } = tx
      const { name = '' } = metadata
      log('new', txs.map(tx => `${txid} ${name}`).join(' '))
    })

    // Perform the spend:
    const metadata: EdgeMetadata = { name: 'me' }
    const savedAction: EdgeTxAction = {
      swapInfo: {
        pluginId: 'myplugin',
        displayName: 'My Plugin',
        supportEmail: 'support@myemail.com'
      },
      payoutAddress: '0xpayoutaddress',
      payoutWalletId: '0xwalletid',
      type: 'swap',
      orderId: 'myorderid',
      canBePartial: false,
      sourceAsset: {
        pluginId: 'bitcoin'
      },
      destAsset: {
        pluginId: 'ethereum',
        tokenId: 'mytokenid'
      }
    }
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
          uniqueIdentifier: 'hello',
          nativeAmount: '50',
          publicAddress: 'somewhere'
        }
      ],
      metadata,
      savedAction,
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
      amountFiat: undefined,
      bizId: undefined,
      category: undefined,
      exchangeAmount: {},
      notes: undefined,
      ...metadata
    })
    expect(txs[0].networkFeeOption).equals('high')
    expect(txs[0].feeRateUsed).deep.equals({ fakePrice: 0 })
    expect(txs[0].spendTargets).deep.equals([
      {
        currencyCode: 'FAKE',
        memo: 'hello',
        nativeAmount: '50',
        publicAddress: 'somewhere',
        uniqueIdentifier: 'hello'
      }
    ])
    expect(txs[0].savedAction).deep.equals({
      swapInfo: {
        pluginId: 'myplugin',
        displayName: 'My Plugin',
        supportEmail: 'support@myemail.com'
      },
      payoutAddress: '0xpayoutaddress',
      payoutWalletId: '0xwalletid',
      type: 'swap',
      orderId: 'myorderid',
      canBePartial: false,
      sourceAsset: {
        pluginId: 'bitcoin'
      },
      destAsset: {
        pluginId: 'ethereum',
        tokenId: 'mytokenid'
      }
    })
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
    const savedAction: EdgeTxAction = {
      swapInfo: {
        pluginId: 'myplugin',
        displayName: 'My Plugin',
        supportEmail: 'support@myemail.com'
      },
      payoutAddress: '0xpayoutaddress',
      payoutWalletId: '0xwalletid',
      type: 'swap',
      orderId: 'myorderid',
      canBePartial: false,
      sourceAsset: {
        pluginId: 'bitcoin'
      },
      destAsset: {
        pluginId: 'ethereum',
        tokenId: 'mytokenid'
      }
    }

    await config.changeUserSettings({ txs: { a: { nativeAmount: '25' } } })
    await wallet.saveTxMetadata('a', 'FAKE', metadata)
    await wallet.saveTxAction('a', null, savedAction)

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
    expect(txs[0].savedAction).deep.equals({
      swapInfo: {
        pluginId: 'myplugin',
        displayName: 'My Plugin',
        supportEmail: 'support@myemail.com'
      },
      payoutAddress: '0xpayoutaddress',
      payoutWalletId: '0xwalletid',
      type: 'swap',
      orderId: 'myorderid',
      canBePartial: false,
      sourceAsset: {
        pluginId: 'bitcoin'
      },
      destAsset: {
        pluginId: 'ethereum',
        tokenId: 'mytokenid'
      }
    })
  })

  it('can be paused and un-paused', async function () {
    const { wallet, context } = await makeFakeCurrencyWallet(true)
    const isEngineRunning = async (): Promise<boolean> => {
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

  it('expose engine failures', async function () {
    const { account } = await makeFakeCurrencyWallet()

    // Creation fails:
    await expectRejection(
      account.createCurrencyWallet('wallet:broken'),
      "SyntaxError: I can't do this"
    )

    // The keys exist, but not the wallet:
    const info = account.getFirstWalletInfo('wallet:broken')
    if (info == null) throw new Error('No wallet info')
    expect(account.currencyWallets[info.id]).equals(undefined)

    // We can get the error various ways:
    const error = account.currencyWalletErrors[info.id]
    expect(error).instanceOf(Error)
    expect(error.message).equals("I can't do this")
    await expectRejection(
      account.waitForCurrencyWallet(info.id),
      "SyntaxError: I can't do this"
    )

    // Loading is complete, even though we have an error:
    await account.waitForAllWallets()
  })
})

/**
 * Adds demo transactions to the fake wallet.
 * These demo transactions use the currency code "BTC",
 * which is different from our fake mainnet code "FAKE",
 * so we also create a custom token so these transactions can appear.
 * @return The fake tokenId for "BTC".
 */
async function addDemoTransactions(
  currencyConfig: EdgeCurrencyConfig
): Promise<string> {
  await currencyConfig.changeUserSettings({
    txs: walletTxs
  })

  const tokenId = await currencyConfig.addCustomToken({
    currencyCode: 'BTC',
    denominations: [],
    displayName: 'Bitcoin',
    networkLocation: {
      contractAddress: 'madeupcontract'
    }
  })
  return tokenId
}

function checkIteratorResult(
  result: IteratorResult<EdgeTransaction[]>,
  txids?: string[]
): void {
  if (txids == null) {
    expect(result.done).equals(true)
  } else {
    expect(result.done).equals(false)
    expect(justTxids(result.value)).deep.equals(txids)
  }
}

function justTxids(txs: EdgeTransaction[]): string[] {
  return txs.map(tx => tx.txid)
}

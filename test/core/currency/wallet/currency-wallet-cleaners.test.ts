import { expect } from 'chai'
import { describe, it } from 'mocha'

import { asEdgeTxAction } from '../../../../src/core/currency/wallet/currency-wallet-cleaners'
import {
  EdgeTxActionSwap,
  EdgeTxActionSwapSend
} from '../../../../src/types/types'

describe('currency wallet cleaners', function () {
  it('round-trips a private swap action', function () {
    const action: EdgeTxActionSwap = {
      actionType: 'swap',
      swapInfo: {
        pluginId: 'fakeswap',
        displayName: 'Fake Swap',
        supportEmail: 'support@fakeswap.test'
      },
      orderId: '1234',
      fromAsset: { pluginId: 'bitcoin', tokenId: null, nativeAmount: '1234' },
      toAsset: { pluginId: 'ethereum', tokenId: null, nativeAmount: '2345' },
      payoutAddress: '0x1234567890abcdef1234567890abcdef12345678',
      payoutWalletId: 'fakeWalletId',
      privacy: true
    }

    const clean = asEdgeTxAction(JSON.parse(JSON.stringify(action)))
    expect(clean).deep.equals({
      orderUri: undefined,
      isEstimate: undefined,
      canBePartial: undefined,
      refundAddress: undefined,
      ...action,
      swapInfo: { isDex: undefined, orderUri: undefined, ...action.swapInfo }
    })
  })

  it('accepts a swap action without a privacy flag', function () {
    const clean = asEdgeTxAction({
      actionType: 'swap',
      swapInfo: {
        pluginId: 'fakeswap',
        displayName: 'Fake Swap',
        supportEmail: ''
      },
      fromAsset: { pluginId: 'bitcoin', tokenId: null, nativeAmount: '1' },
      toAsset: { pluginId: 'ethereum', tokenId: null, nativeAmount: '2' },
      payoutAddress: 'somewhere',
      payoutWalletId: 'fakeWalletId'
    })
    expect(clean.actionType).equals('swap')
    expect('privacy' in clean && clean.privacy).equals(undefined)
  })

  it('round-trips a swapSend action', function () {
    const action: EdgeTxActionSwapSend = {
      actionType: 'swapSend',
      swapInfo: {
        pluginId: 'fakeswap',
        displayName: 'Fake Swap',
        supportEmail: 'support@fakeswap.test'
      },
      orderId: '1234',
      isEstimate: true,
      fromAsset: { pluginId: 'bitcoin', tokenId: null, nativeAmount: '1234' },
      toAsset: { pluginId: 'ethereum', tokenId: null, nativeAmount: '2345' },
      payoutAddress: '0x1234567890abcdef1234567890abcdef12345678',
      privacy: true
    }

    const clean = asEdgeTxAction(JSON.parse(JSON.stringify(action)))
    expect(clean).deep.equals({
      orderUri: undefined,
      refundAddress: undefined,
      ...action,
      swapInfo: { isDex: undefined, orderUri: undefined, ...action.swapInfo }
    })
  })

  it('rejects a swapSend action without a privacy flag', function () {
    expect(() =>
      asEdgeTxAction({
        actionType: 'swapSend',
        swapInfo: {
          pluginId: 'fakeswap',
          displayName: 'Fake Swap',
          supportEmail: ''
        },
        isEstimate: false,
        fromAsset: { pluginId: 'bitcoin', tokenId: null },
        toAsset: { pluginId: 'ethereum', tokenId: null },
        payoutAddress: 'somewhere'
      })
    ).to.throw()
  })
})

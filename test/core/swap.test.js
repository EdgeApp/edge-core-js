// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { pickBestQuote } from '../../src/core/swap/swap-api.js'
import {
  type EdgeSwapInfo,
  type EdgeSwapQuote,
  type EdgeSwapRequest
} from '../../src/index.js'

const typeHack: any = {}

const request: EdgeSwapRequest = typeHack
const dummySwapInfo: EdgeSwapInfo = {
  pluginId: '',
  displayName: '',
  supportEmail: ''
}

const quotes: EdgeSwapQuote[] = [
  {
    request,
    swapInfo: dummySwapInfo,
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '347987',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    pluginId: 'changenow',
    expirationDate: new Date('2022-01-21T04:35:22.033Z'),
    isEstimate: false,
    approve: async () => typeHack,
    close: async () => undefined
  },
  {
    request,
    swapInfo: dummySwapInfo,
    isEstimate: false,
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '321913.5410141837507493644',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    expirationDate: new Date('2022-01-21T04:35:18.000Z'),
    pluginId: 'switchain',
    approve: async () => typeHack,
    close: async () => undefined
  },
  {
    request,
    swapInfo: dummySwapInfo,
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '327854',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    pluginId: 'godex',
    expirationDate: new Date('2022-01-21T04:53:22.097Z'),
    isEstimate: false,
    approve: async () => typeHack,
    close: async () => undefined
  },
  {
    request,
    swapInfo: { ...dummySwapInfo, isDex: true },
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '326854',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    pluginId: 'thorchain',
    expirationDate: new Date('2022-01-21T04:53:22.097Z'),
    isEstimate: false,
    approve: async () => typeHack,
    close: async () => undefined
  }
]

describe('swap', function () {
  it('picks the best quote', function () {
    const quote = pickBestQuote(quotes, {})
    expect(quote.pluginId).equals('changenow')
  })

  it('picks the preferred swap provider', function () {
    const quote = pickBestQuote(quotes, { preferPluginId: 'switchain' })
    expect(quote.pluginId).equals('switchain')
  })

  it('picks the preferred swap type DEX', function () {
    const quote = pickBestQuote(quotes, { preferType: 'DEX' })
    expect(quote.pluginId).equals('thorchain')
  })

  it('picks the preferred swap type CEX', function () {
    const quote = pickBestQuote(quotes, { preferType: 'CEX' })
    expect(quote.pluginId).equals('changenow')
  })

  it('picks the swap provider with an active promo code', function () {
    const quote = pickBestQuote(quotes, {
      promoCodes: {
        switchain: 'deal10'
      }
    })
    expect(quote.pluginId).equals('switchain')
  })
})

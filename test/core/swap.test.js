// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { pickBestQuote } from '../../src/core/swap/swap-api.js'
import { type EdgeSwapQuote } from '../../src/index.js'

const typeHack: any = {}

const quotes: EdgeSwapQuote[] = [
  {
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '347987',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    destinationAddress: '3PPDPQUptVHpQxJNK1UcHX8SPCXBSf4rxf',
    pluginId: 'changenow',
    expirationDate: new Date('2022-01-21T04:35:22.033Z'),
    quoteId: '9ddc6773080029',
    isEstimate: false,
    approve: async () => typeHack,
    close: async () => undefined
  },
  {
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
    fromNativeAmount: '51734472727286000',
    toNativeAmount: '327854',
    networkFee: {
      currencyCode: 'ETH',
      nativeAmount: '3492187272714000'
    },
    destinationAddress: '3PPDPQUptVHpQxJNK1UcHX8SPCXBSf4rxf',
    pluginId: 'godex',
    expirationDate: new Date('2022-01-21T04:53:22.097Z'),
    quoteId: '61ea3791b72d9',
    isEstimate: false,
    approve: async () => typeHack,
    close: async () => undefined
  }
]

describe('swap', function () {
  it('picks the best quote', function () {
    const quote = pickBestQuote(quotes, undefined, {})
    expect(quote.pluginId).equals('changenow')
  })

  it('picks the preferred swap provider', function () {
    const quote = pickBestQuote(quotes, 'switchain', {})
    expect(quote.pluginId).equals('switchain')
  })

  it('picks the swap provider with an active promo code', function () {
    const quote = pickBestQuote(quotes, undefined, {
      switchain: 'deal10'
    })
    expect(quote.pluginId).equals('switchain')
  })
})

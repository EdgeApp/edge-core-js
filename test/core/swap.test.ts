import { expect } from 'chai'
import { describe, it } from 'mocha'

import { isSwapPluginQueryable, sortQuotes } from '../../src/core/swap/swap-api'
import { EdgeSwapInfo, EdgeSwapQuote, EdgeSwapRequest } from '../../src/index'

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
    } as any,
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
    } as any,
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
    } as any,
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
  const getIds = (quotes: EdgeSwapQuote[]): string =>
    quotes.map(quote => quote.pluginId).join(', ')

  it('picks the best quote', function () {
    const sorted = sortQuotes(quotes, {})
    expect(getIds(sorted)).equals('changenow, godex, thorchain, switchain')
  })

  it('picks the preferred swap provider', function () {
    const sorted = sortQuotes(quotes, { preferPluginId: 'switchain' })
    expect(getIds(sorted)).equals('switchain, changenow, godex, thorchain')
  })

  it('picks the preferred swap type DEX', function () {
    const sorted = sortQuotes(quotes, { preferType: 'DEX' })
    expect(getIds(sorted)).equals('thorchain, changenow, godex, switchain')
  })

  it('picks the preferred swap type CEX', function () {
    const sorted = sortQuotes(quotes, { preferType: 'CEX' })
    expect(getIds(sorted)).equals('changenow, godex, switchain, thorchain')
  })

  it('picks the swap provider with an active promo code', function () {
    const sorted = sortQuotes(quotes, {
      promoCodes: {
        switchain: 'deal10'
      }
    })
    expect(getIds(sorted)).equals('switchain, changenow, godex, thorchain')
  })
})

describe('swap plugin selection', function () {
  // The whole truth table, because the interesting cases are the corners: a
  // caller must be able to reach a provider the user switched off, and must
  // never be able to reach one it disabled itself in the same call.
  const cases: Array<{
    enabled: boolean
    forceEnabled: boolean
    disabled: boolean
    queryable: boolean
  }> = [
    { enabled: true, forceEnabled: false, disabled: false, queryable: true },
    { enabled: true, forceEnabled: true, disabled: false, queryable: true },
    { enabled: false, forceEnabled: false, disabled: false, queryable: false },
    // The send scene's stealth path: Houdini powers the feature, so the swap
    // setting does not get to switch the feature off.
    { enabled: false, forceEnabled: true, disabled: false, queryable: true },
    { enabled: true, forceEnabled: false, disabled: true, queryable: false },
    // `disabled` beats `forceEnabled`. Stealth sends disable every other
    // plugin and force-enable Houdini in the same call, so a bug here would
    // let the aggregator answer a request that demanded one provider.
    { enabled: true, forceEnabled: true, disabled: true, queryable: false },
    { enabled: false, forceEnabled: false, disabled: true, queryable: false },
    { enabled: false, forceEnabled: true, disabled: true, queryable: false }
  ]

  for (const { queryable, ...flags } of cases) {
    it(`${JSON.stringify(flags)} -> ${String(queryable)}`, function () {
      expect(isSwapPluginQueryable(flags)).equals(queryable)
    })
  }
})

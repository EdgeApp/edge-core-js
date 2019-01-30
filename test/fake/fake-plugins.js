// @flow

import {
  type EdgeRateHint,
  type EdgeRatePair,
  type EdgeRatePlugin,
  addEdgeCorePlugins,
  lockEdgeCorePlugins
} from '../../src/index.js'
import { fakeCurrencyPlugin } from './fake-currency-plugin.js'

export const brokenExchangePlugin: EdgeRatePlugin = {
  rateInfo: {
    displayName: 'BrokenExchange'
  },

  fetchRates (pairs) {
    throw new Error('boom!')
  }
}

const fakeExchangePlugin: EdgeRatePlugin = {
  rateInfo: {
    displayName: 'FakeExchange'
  },

  fetchRates (pairs: Array<EdgeRateHint>): Promise<Array<EdgeRatePair>> {
    const fuzz = Math.sin((Math.PI * Date.now()) / (30 * 60 * 1000))

    return Promise.resolve([
      { fromCurrency: 'BTC', toCurrency: 'iso:EUR', rate: 2275.58 + fuzz },
      {
        fromCurrency: 'BTC',
        toCurrency: 'iso:JPY',
        rate: 293514.66 + fuzz
      },
      { fromCurrency: 'BTC', toCurrency: 'iso:USD', rate: 2590.75 + fuzz },
      { fromCurrency: 'ETH', toCurrency: 'iso:EUR', rate: 230.74 + fuzz },
      { fromCurrency: 'ETH', toCurrency: 'iso:USD', rate: 2590.75 + fuzz },
      { fromCurrency: 'FAKE', toCurrency: 'iso:USD', rate: 3 }
    ])
  }
}

addEdgeCorePlugins({
  'broken-plugin': () => {
    throw new Error('Expect to fail')
  },
  'broken-exchange': () => brokenExchangePlugin,
  'fake-exchange': fakeExchangePlugin,
  fakecoin: fakeCurrencyPlugin
})
lockEdgeCorePlugins()

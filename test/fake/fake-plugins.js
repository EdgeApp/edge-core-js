// @flow

import {
  type EdgeExchangePair,
  type EdgeExchangePairHint,
  type EdgeExchangePlugin,
  addEdgeCorePlugins,
  lockEdgeCorePlugins
} from '../../src/index.js'
import { makeFakeCurrencyPlugin } from './fake-currency-plugin.js'

export const brokenExchangePlugin: EdgeExchangePlugin = {
  exchangeInfo: {
    exchangeName: 'BrokenExchange'
  },

  fetchExchangeRates (pairs) {
    throw new Error('boom!')
  }
}

export const fakeExchangePlugin: EdgeExchangePlugin = {
  exchangeInfo: {
    exchangeName: 'FakeExchange'
  },

  fetchExchangeRates (
    pairs: Array<EdgeExchangePairHint>
  ): Promise<Array<EdgeExchangePair>> {
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
  fakecoin: makeFakeCurrencyPlugin
})
lockEdgeCorePlugins()

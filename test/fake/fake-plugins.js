// @flow

import {
  type EdgeRateHint,
  type EdgeRatePair,
  type EdgeRatePlugin
} from '../../src/index.js'
import { fakeCurrencyPlugin } from './fake-currency-plugin.js'
import { fakeSwapPlugin } from './fake-swap-plugin.js'

export const brokenExchangePlugin: EdgeRatePlugin = {
  rateInfo: {
    displayName: 'BrokenExchange'
  },

  fetchRates(pairs: EdgeRateHint[]) {
    throw new Error('boom!')
  }
}

const fakeExchangePlugin: EdgeRatePlugin = {
  rateInfo: {
    displayName: 'FakeExchange'
  },

  fetchRates(pairs: EdgeRateHint[]): Promise<EdgeRatePair[]> {
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

export const allPlugins = {
  'broken-plugin': () => {
    throw new Error('Expect to fail')
  },
  'broken-exchange': () => brokenExchangePlugin,
  'fake-exchange': fakeExchangePlugin,
  fakecoin: fakeCurrencyPlugin,
  fakeswap: fakeSwapPlugin
}

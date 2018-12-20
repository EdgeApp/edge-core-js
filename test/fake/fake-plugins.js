// @flow

import {
  type EdgeCurrencyPluginFactory,
  type EdgeExchangePair,
  type EdgeExchangePairHint,
  type EdgeExchangePlugin,
  type EdgeExchangePluginFactory
} from '../../src/index.js'

export const brokenCurrencyPlugin: EdgeCurrencyPluginFactory = {
  pluginName: 'broken-currency',
  pluginType: 'currency',

  makePlugin () {
    return Promise.reject(new Error('Expect to fail'))
  }
}

export const brokenExchangePlugin: EdgeExchangePluginFactory = {
  pluginType: 'exchange',

  makePlugin () {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'BrokenExchange'
      },

      fetchExchangeRates (pairs) {
        throw new Error('boom!')
      }
    })
  }
}

export const fakeExchangePlugin: EdgeExchangePluginFactory = {
  pluginType: 'exchange',

  makePlugin (): Promise<EdgeExchangePlugin> {
    const plugin: EdgeExchangePlugin = {
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
    return Promise.resolve(plugin)
  }
}

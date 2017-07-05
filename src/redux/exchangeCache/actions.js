import { getExchangePlugins } from '../selectors.js'
import { addPairs } from './reducer.js'

export function fetchExchangeRates () {
  return (dispatch, getState) => {
    const state = getState()
    const plugins = getExchangePlugins(state)

    // TODO: Stop hard-coding this once wallets have a fiat setting:
    const pairs = [
      { fromCurrency: 'BTC', toCurrency: 'iso:EUR' },
      { fromCurrency: 'BTC', toCurrency: 'iso:USD' },
      { fromCurrency: 'ETH', toCurrency: 'iso:EUR' },
      { fromCurrency: 'ETH', toCurrency: 'iso:USD' }
    ]

    return Promise.all(
      plugins.map(plugin => plugin.fetchExchangeRates(pairs))
    ).then(pairLists => {
      const timestamp = Date.now() / 1000
      const pairs = []
      for (let i = 0; i < plugins.length; ++i) {
        const source = plugins[i].exchangeInfo.exchangeName
        for (const pair of pairLists[i]) {
          const { fromCurrency, toCurrency, rate } = pair
          pairs.push({ fromCurrency, toCurrency, rate, source, timestamp })
        }
      }

      return dispatch(addPairs(pairs))
    })
  }
}

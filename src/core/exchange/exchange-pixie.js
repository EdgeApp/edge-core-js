// @flow

import { type PixieInput, type TamePixie, combinePixies } from 'redux-pixies'

import { type RootProps } from '../root-pixie.js'
import { type ExchangePair } from './exchange-reducer.js'

export const exchange: TamePixie<RootProps> = combinePixies({
  update (input: PixieInput<RootProps>) {
    let timeout: * // Infer the proper timer type

    function doFetch (): Promise<mixed> {
      // Bail out if we have no plugins:
      if (!input.props.state.plugins.locked) return Promise.resolve()

      // TODO: Grab this off the list of loaded wallet currency types & fiats:
      const pairs = [
        { fromCurrency: 'BTC', toCurrency: 'iso:EUR' },
        { fromCurrency: 'BTC', toCurrency: 'iso:USD' },
        { fromCurrency: 'ETH', toCurrency: 'iso:EUR' },
        { fromCurrency: 'ETH', toCurrency: 'iso:USD' }
      ]

      const pluginNames = Object.keys(input.props.state.plugins.rate)
      return Promise.all(
        pluginNames.map(pluginName => {
          const plugin = input.props.state.plugins.rate[pluginName]
          try {
            return plugin.fetchExchangeRates(pairs).catch(e => {
              input.props.onError(e)
              return []
            })
          } catch (e) {
            input.props.onError(e)
            return []
          }
        })
      ).then(pairLists => {
        const timestamp = Date.now() / 1000
        const pairs: Array<ExchangePair> = []
        for (let i = 0; i < pluginNames.length; ++i) {
          for (const pair of pairLists[i]) {
            const { fromCurrency, toCurrency, rate } = pair
            pairs.push({
              fromCurrency,
              toCurrency,
              rate,
              source: pluginNames[i],
              timestamp
            })
          }
        }

        input.props.dispatch({ type: 'EXCHANGE_PAIRS_FETCHED', payload: pairs })
        timeout = setTimeout(doFetch, 30 * 1000)
        return void 0
      })
    }

    return {
      update (props: RootProps): Promise<mixed> | void {
        // Kick off the initial fetch if we don't already have one running:
        if (timeout == null) return doFetch()
      },

      destroy () {
        clearTimeout(timeout)
      }
    }
  }
})

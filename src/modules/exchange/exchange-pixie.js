// @flow

import { combinePixies, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'

import type { EdgeExchangePlugin } from '../../edge-core-index.js'
import { rejectify } from '../../util/decorators.js'
import type { RootProps } from '../root.js'
import type { ExchangePair } from './exchange-reducer.js'

export interface ExchangeOutput {
  plugins: Array<EdgeExchangePlugin>;
  update: mixed;
}

export default combinePixies({
  plugins (input: PixieInput<RootProps>) {
    return (props: RootProps): mixed => {
      const opts = { io: (props.io: any) }
      const promises: Array<Promise<EdgeExchangePlugin>> = []
      for (const plugin of props.plugins) {
        if (plugin.pluginType === 'exchange') {
          promises.push(plugin.makePlugin(opts))
        }
      }

      Promise.all(promises).then(plugins => input.onOutput(plugins))
      return stopUpdates
    }
  },

  update (input: PixieInput<RootProps>) {
    let timeout: * // Infer the proper timer type

    function doFetch (): Promise<mixed> {
      // Bail out if we have no plugins:
      if (!input.props.output.exchange.plugins) return Promise.resolve()

      const plugins = input.props.output.exchange.plugins

      // TODO: Grab this off the list of loaded wallet currency types & fiats:
      const pairs = [
        { fromCurrency: 'BTC', toCurrency: 'iso:EUR' },
        { fromCurrency: 'BTC', toCurrency: 'iso:USD' },
        { fromCurrency: 'ETH', toCurrency: 'iso:EUR' },
        { fromCurrency: 'ETH', toCurrency: 'iso:USD' }
      ]

      return Promise.all(
        plugins.map(plugin =>
          rejectify(plugin.fetchExchangeRates)(pairs).catch(e => {
            input.props.onError(e)
            return []
          })
        )
      ).then(pairLists => {
        const timestamp = Date.now() / 1000
        const pairs: Array<ExchangePair> = []
        for (let i = 0; i < plugins.length; ++i) {
          const source = plugins[i].exchangeInfo.exchangeName
          for (const pair of pairLists[i]) {
            const { fromCurrency, toCurrency, rate } = pair
            pairs.push({
              fromCurrency,
              toCurrency,
              rate,
              source,
              timestamp
            })
          }
        }

        try {
          input.props.onExchangeUpdate()
        } catch (e) {
          input.props.onError(e)
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

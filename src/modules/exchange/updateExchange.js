// @flow
import type { AbcExchangePlugin } from 'airbitz-core-types'
import type { PixieInput } from 'redux-pixies'
import { rejectify } from '../../util/decorators.js'
import type { RootProps } from '../root.js'
import { addPairs } from './reducer.js'

export function exchangePixie (input: PixieInput<RootProps>) {
  let timeout: number | void

  return {
    update (props: RootProps): Promise<void> | void {
      function doFetch (plugins: Array<AbcExchangePlugin>): Promise<void> {
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
              props.onError(e)
              return []
            })
          )
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

          timeout = setTimeout(doFetch, 30 * 1000)
          props.dispatch(addPairs(pairs))
          return void 0
        })
      }

      // Do an initial fetch once the plugins are loaded:
      if (timeout == null && props.output && props.output.exchangePlugins) {
        return doFetch(props.output.exchangePlugins)
      }
    },

    destroy () {
      clearTimeout(timeout)
    }
  }
}

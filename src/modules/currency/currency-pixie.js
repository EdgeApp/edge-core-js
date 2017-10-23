// @flow
import type { AbcCurrencyPlugin } from 'airbitz-core-types'
import { combinePixies, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'
import type { RootProps } from '../root.js'

export interface CurrencyOutput {
  plugins: Array<AbcCurrencyPlugin>;
}

export default combinePixies({
  plugins (input: PixieInput<RootProps>) {
    return (props: RootProps): any => {
      const opts = { io: (props.io: any) }
      const promises: Array<Promise<AbcCurrencyPlugin>> = []
      for (const plugin of props.plugins) {
        if (plugin.pluginType === 'currency') {
          promises.push(plugin.makePlugin(opts))
        }
      }

      return Promise.all(promises).then(plugins => {
        input.onOutput(plugins)
        input.props.dispatch({
          type: 'CURRENCY_PLUGINS_LOADED',
          payload: plugins.map(plugin => plugin.currencyInfo)
        })

        return stopUpdates
      })
    }
  }
})

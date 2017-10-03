// @flow
import { setPlugins } from '../../redux/plugins/reducer.js'
import type { RootProps } from '../rootPixie.js'
import { stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'
import type { AbcCurrencyPlugin, AbcExchangePlugin } from 'airbitz-core-types'

export function currencyPlugins (input: PixieInput<RootProps>) {
  return (props: RootProps): any => {
    const opts = { io: (props.io: any) }
    const promises: Array<Promise<AbcCurrencyPlugin>> = []
    for (const plugin of props.plugins) {
      if (plugin.pluginType === 'currency') {
        promises.push(plugin.makePlugin(opts))
      }
    }

    Promise.all(promises).then(plugins => input.onOutput(plugins))
    return stopUpdates
  }
}

export function exchangePlugins (input: PixieInput<RootProps>) {
  return (props: RootProps): any => {
    const opts = { io: (props.io: any) }
    const promises: Array<Promise<AbcExchangePlugin>> = []
    for (const plugin of props.plugins) {
      if (plugin.pluginType === 'exchange') {
        promises.push(plugin.makePlugin(opts))
      }
    }

    Promise.all(promises).then(plugins => input.onOutput(plugins))
    return stopUpdates
  }
}

export function tempPluginsDispatch () {
  return function (props: RootProps) {
    if (
      props.output &&
      props.output.currencyPlugins &&
      props.output.exchangePlugins &&
      !props.state.plugins.loaded
    ) {
      const { currencyPlugins, exchangePlugins } = props.output
      props.dispatch(setPlugins(currencyPlugins, exchangePlugins))
    }
  }
}

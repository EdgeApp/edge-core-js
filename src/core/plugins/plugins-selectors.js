// @flow

import {
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  type EdgePluginMap
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { type RootState } from '../root-reducer.js'

/**
 * Finds the currency plugin that can handle a particular wallet type.
 */
export function findCurrencyPlugin(
  plugins: EdgePluginMap<EdgeCurrencyPlugin>,
  walletType: string
): string | void {
  for (const pluginName in plugins) {
    const { currencyInfo } = plugins[pluginName]
    if (walletType === currencyInfo.walletType) return pluginName
  }
}

/**
 * Finds the currency plugin that can handle a particular wallet type.
 */
export function getCurrencyPlugin(
  state: RootState,
  walletType: string
): EdgeCurrencyPlugin {
  const pluginName = findCurrencyPlugin(state.plugins.currency, walletType)
  if (pluginName == null) {
    throw new Error(
      `Cannot find a currency plugin for wallet type ${walletType}`
    )
  }
  return state.plugins.currency[pluginName]
}

/**
 * Finds the currency tools for a particular wallet type,
 * loading them if needed.
 */
export function getCurrencyTools(
  ai: ApiInput,
  walletType: string
): Promise<EdgeCurrencyTools> {
  const { dispatch, state } = ai.props

  const pluginName = findCurrencyPlugin(state.plugins.currency, walletType)
  if (pluginName == null) {
    throw new Error(
      `Cannot find a currency plugin for wallet type ${walletType}`
    )
  }

  // Already loaded / loading:
  const tools = state.plugins.currencyTools[pluginName]
  if (tools != null) return tools

  // Never touched, so start the load:
  const plugin = getCurrencyPlugin(state, walletType)
  const promise = plugin.makeCurrencyTools()
  dispatch({
    type: 'CURRENCY_TOOLS_LOADED',
    payload: { pluginName, tools: promise }
  })
  return promise
}

/**
 * Waits for the plugins to load,
 * then validates that all plugins are present.
 */
export function waitForPlugins(ai: ApiInput) {
  return ai.waitFor(props => {
    const { init, locked } = props.state.plugins
    if (!locked) return

    const missingPlugins: string[] = []
    for (const pluginName in init) {
      if (
        !!init[pluginName] &&
        props.state.plugins.currency[pluginName] == null &&
        props.state.plugins.rate[pluginName] == null &&
        props.state.plugins.swap[pluginName] == null
      ) {
        missingPlugins.push(pluginName)
      }
    }
    if (missingPlugins.length > 0) {
      throw new Error(
        'The following plugins are missing or failed to load: ' +
          missingPlugins.join(', ')
      )
    }
    return true
  })
}

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
  for (const pluginId in plugins) {
    const { currencyInfo } = plugins[pluginId]
    if (walletType === currencyInfo.walletType) return pluginId
  }
}

/**
 * Finds the currency plugin that can handle a particular wallet type.
 */
export function getCurrencyPlugin(
  state: RootState,
  walletType: string
): EdgeCurrencyPlugin {
  const pluginId = findCurrencyPlugin(state.plugins.currency, walletType)
  if (pluginId == null) {
    throw new Error(
      `Cannot find a currency plugin for wallet type ${walletType}`
    )
  }
  return state.plugins.currency[pluginId]
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

  const pluginId = findCurrencyPlugin(state.plugins.currency, walletType)
  if (pluginId == null) {
    throw new Error(
      `Cannot find a currency plugin for wallet type ${walletType}`
    )
  }

  // Already loaded / loading:
  const tools = state.plugins.currencyTools[pluginId]
  if (tools != null) return tools

  // Never touched, so start the load:
  const plugin = getCurrencyPlugin(state, walletType)
  const promise = plugin.makeCurrencyTools()
  dispatch({
    type: 'CURRENCY_TOOLS_LOADED',
    payload: { pluginId, tools: promise }
  })
  return promise
}

/**
 * Waits for the plugins to load,
 * then validates that all plugins are present.
 */
export async function waitForPlugins(ai: ApiInput): Promise<void> {
  await ai.waitFor(props => {
    const { init, locked } = props.state.plugins
    if (!locked) return

    const { currency, rate, swap } = props.state.plugins
    const missingPlugins: string[] = []
    for (const pluginId in init) {
      if (
        !!init[pluginId] &&
        currency[pluginId] == null &&
        rate[pluginId] == null &&
        swap[pluginId] == null
      ) {
        missingPlugins.push(pluginId)
      }
    }
    if (missingPlugins.length > 0) {
      throw new Error(
        'The following plugins are missing or failed to load: ' +
          missingPlugins.join(', ')
      )
    }

    // Upgrade deprecated pluginName field for currency plugins:
    for (const pluginId of Object.keys(currency)) {
      const typeHack: any = currency[pluginId].currencyInfo
      if (typeHack.pluginName != null) typeHack.pluginId = pluginId
    }

    return true
  })
}

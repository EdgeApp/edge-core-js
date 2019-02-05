// @flow

import {
  type EdgeCurrencyPlugin,
  type EdgePluginMap
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { type RootState } from '../root-reducer.js'

/**
 * Finds the currency plugin that can handle a particular wallet type.
 */
export function findCurrencyPlugin (
  plugins: EdgePluginMap<EdgeCurrencyPlugin>,
  walletType: string
): string | void {
  for (const pluginName in plugins) {
    const { currencyInfo } = plugins[pluginName]
    for (const type of currencyInfo.walletTypes) {
      if (type === walletType) return pluginName
    }
  }
}

/**
 * Finds the currency plugin that can handle a particular wallet type.
 */
export function getCurrencyPlugin (
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
 * Waits for the plugins to load,
 * then validates that all plugins are present.
 */
export function waitForPlugins (ai: ApiInput) {
  return ai.waitFor(props => {
    if (!props.state.plugins.locked) return
    if (props.state.plugins.error) throw props.state.plugins.error
    return true
  })
}

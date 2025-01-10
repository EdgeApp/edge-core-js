import {
  EdgeCorePluginsInit,
  EdgeCurrencyPlugin,
  EdgeCurrencyTools,
  EdgePluginMap,
  EdgeSwapPlugin
} from '../../types/types'
import { RootAction } from '../actions'

export interface PluginsState {
  readonly init: EdgeCorePluginsInit
  readonly locked: boolean

  readonly currency: EdgePluginMap<EdgeCurrencyPlugin>
  readonly swap: EdgePluginMap<EdgeSwapPlugin>

  readonly currencyTools: EdgePluginMap<Promise<EdgeCurrencyTools>>
}

const initialState: PluginsState = {
  init: {},
  locked: false,
  currency: {},
  swap: {},
  currencyTools: {}
}

export const plugins = (
  state: PluginsState = initialState,
  action: RootAction
): PluginsState => {
  switch (action.type) {
    case 'CORE_PLUGINS_ADDED': {
      const out = {
        ...state,
        currency: { ...state.currency },
        swap: { ...state.swap }
      }
      for (const pluginId of Object.keys(action.payload)) {
        const plugin = action.payload[pluginId]

        // Don't stop loading the bundle if plugin(s) fail to load. Some plugins may rely on advanced features
        // that aren't locally available so we can skip loading those but should continue and load what we can.
        if (plugin == null) {
          out.init = { ...out.init, [pluginId]: false }
          continue
        }

        if ('currencyInfo' in plugin) {
          // Update the currencyInfo display names, if necessary
          if (plugin.currencyInfo.chainDisplayName == null) {
            plugin.currencyInfo.chainDisplayName =
              plugin.currencyInfo.displayName
          }
          if (plugin.currencyInfo.assetDisplayName == null) {
            plugin.currencyInfo.assetDisplayName =
              plugin.currencyInfo.displayName
          }

          out.currency[pluginId] = plugin
        }
        if ('swapInfo' in plugin) out.swap[pluginId] = plugin
      }
      return out
    }
    case 'CORE_PLUGINS_LOCKED':
      return { ...state, locked: true }
    case 'CURRENCY_TOOLS_LOADED': {
      const currencyTools = { ...state.currencyTools }
      currencyTools[action.payload.pluginId] = action.payload.tools
      return { ...state, currencyTools }
    }
    case 'INIT':
      return { ...state, init: action.payload.pluginsInit }
  }
  return state
}

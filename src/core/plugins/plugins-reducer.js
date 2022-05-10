// @flow

import {
  type EdgeCorePluginsInit,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  type EdgeOtherPlugin,
  type EdgePluginMap,
  type EdgeRatePlugin,
  type EdgeSwapPlugin
} from '../../types/types.js'
import { type RootAction } from '../actions.js'

export type PluginsState = {
  +init: EdgeCorePluginsInit,
  +locked: boolean,

  +currency: EdgePluginMap<EdgeCurrencyPlugin>,
  +rate: EdgePluginMap<EdgeRatePlugin>,
  +swap: EdgePluginMap<EdgeSwapPlugin>,
  +other: EdgePluginMap<EdgeOtherPlugin<any>>,

  +currencyTools: EdgePluginMap<Promise<EdgeCurrencyTools>>
}

const initialState: PluginsState = {
  init: {},
  locked: false,
  currency: {},
  rate: {},
  swap: {},
  other: {},
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
        rate: { ...state.rate },
        swap: { ...state.swap },
        other: { ...state.other }
      }
      for (const pluginId of Object.keys(action.payload)) {
        const plugin = action.payload[pluginId]
        // $FlowFixMe - Flow doesn't see the type refinement here:
        if (plugin.currencyInfo != null) out.currency[pluginId] = plugin
        // $FlowFixMe
        if (plugin.rateInfo != null) out.rate[pluginId] = plugin
        // $FlowFixMe
        if (plugin.swapInfo != null) out.swap[pluginId] = plugin
        // $FlowFixMe
        if (plugin.getOtherMethods != null) out.other[pluginId] = plugin
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

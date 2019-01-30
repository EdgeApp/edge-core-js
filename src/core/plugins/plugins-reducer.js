// @flow

import {
  type EdgeCorePluginsInit,
  type EdgeCurrencyPlugin,
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
  +swap: EdgePluginMap<EdgeSwapPlugin>
}

const initialState: PluginsState = {
  init: {},
  locked: false,
  currency: {},
  rate: {},
  swap: {}
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
        swap: { ...state.swap }
      }
      for (const pluginName in action.payload) {
        const plugin = action.payload[pluginName]
        // $FlowFixMe - Flow doesn't see the type refinement here:
        if (plugin.currencyInfo != null) out.currency[pluginName] = plugin
        // $FlowFixMe
        if (plugin.rateInfo != null) out.rate[pluginName] = plugin
        // $FlowFixMe
        if (plugin.swapInfo != null) out.swap[pluginName] = plugin
      }
      return out
    }
    case 'CORE_PLUGINS_LOCKED':
      return { ...state, locked: true }
    case 'INIT':
      return { ...state, init: action.payload.pluginsInit }
  }
  return state
}

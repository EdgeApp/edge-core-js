// @flow

import {
  type EdgeCorePluginsInit,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
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

  +currencyTools: EdgePluginMap<EdgeCurrencyTools | Error | 'pending'>
}

const initialState: PluginsState = {
  init: {},
  locked: false,
  currency: {},
  rate: {},
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
    case 'CURRENCY_TOOLS_LOADING': {
      const currencyTools = { ...state.currencyTools }
      currencyTools[action.payload.pluginName] = 'pending'
      return { ...state, currencyTools }
    }
    case 'CURRENCY_TOOLS_LOADED': {
      const currencyTools = { ...state.currencyTools }
      currencyTools[action.payload.pluginName] = action.payload.tools
      return { ...state, currencyTools }
    }
    case 'INIT':
      return { ...state, init: action.payload.pluginsInit }
  }
  return state
}

// @flow

import {
  type EdgeCurrencyPlugin,
  type EdgeExchangePlugin,
  type EdgePluginMap,
  type EdgeSwapPlugin
} from '../../types/types.js'
import { type RootAction } from '../actions.js'

export type PluginsState = {
  +error: Error | void,
  +locked: boolean,

  +currency: EdgePluginMap<EdgeCurrencyPlugin>,
  +rate: EdgePluginMap<EdgeExchangePlugin>,
  +swap: EdgePluginMap<EdgeSwapPlugin>
}

const initialState: PluginsState = {
  error: void 0,
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
        locked: true,
        currency: { ...state.currency },
        rate: { ...state.rate },
        swap: { ...state.swap }
      }
      for (const pluginName in action.payload) {
        const plugin = action.payload[pluginName]
        // $FlowFixMe - Flow doesn't see the type refinement here:
        if (plugin.currencyInfo != null) out.currency[pluginName] = plugin
        // $FlowFixMe
        if (plugin.exchangeInfo != null) out.rate[pluginName] = plugin
        // $FlowFixMe
        if (plugin.swapInfo != null) out.swap[pluginName] = plugin
      }
      return out
    }
    case 'CORE_PLUGINS_FAILED': {
      return { ...state, error: action.payload, locked: true }
    }
  }
  return state
}

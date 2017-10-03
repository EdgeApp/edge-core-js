// @flow
import type {
  AbcContext,
  AbcCurrencyPlugin,
  AbcExchangePlugin
} from 'airbitz-core-types'
import { combinePixies } from 'redux-pixies'
import { contextApiPixie } from './context/context-api-pixie.js'
import { exchangePixie } from './exchange/updateExchange.js'
import {
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch
} from './plugins/loadPlugins.js'

// The top-level pixie output structure:
export interface RootOutput {
  contextApi: AbcContext,
  currencyPlugins: Array<AbcCurrencyPlugin>,
  exchangePlugins: Array<AbcExchangePlugin>
}

export const rootPixie = combinePixies({
  contextApi: contextApiPixie,
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch,
  exchangePixie
})

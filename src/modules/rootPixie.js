// @flow
import type {
  AbcContext,
  AbcCurrencyPlugin,
  AbcExchangePlugin
} from 'airbitz-core-types'
import { combinePixies, filterPixie } from 'redux-pixies'
import { contextApiPixie } from './context/context-api-pixie.js'
import { exchangePixie } from './exchange/updateExchange.js'
import {
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch
} from './plugins/loadPlugins.js'
import { makeApiProps } from './root.js'

import currencyWalletPixie from './currencyWallets/currency-wallet-pixie.js'

// The top-level pixie output structure:
export interface RootOutput {
  contextApi: AbcContext,
  currencyPlugins: Array<AbcCurrencyPlugin>,
  exchangePlugins: Array<AbcExchangePlugin>
}

export const rootPixie = combinePixies({
  contextApi: filterPixie(contextApiPixie, makeApiProps),
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch,
  exchangePixie,
  currencyWalletPixie
})

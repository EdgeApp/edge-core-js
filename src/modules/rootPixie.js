// @flow
import type {
  AbcCorePlugin,
  AbcCurrencyPlugin,
  AbcExchangePlugin
} from 'airbitz-core-types'
import type { Dispatch } from 'redux'
import { combinePixies } from 'redux-pixies'
import type { FixedIo } from '../io/fixIo.js'
import { exchangePixie } from './exchange/updateExchange.js'
import {
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch
} from './plugins/loadPlugins.js'
import type { CoreRoot } from './root.js'
import type { RootState } from './rootReducer.js'

// The top-level pixie output structure:
export interface RootOutput {
  currencyPlugins: Array<AbcCurrencyPlugin>,
  exchangePlugins: Array<AbcExchangePlugin>
}

// Props passed to the root pixie:
export interface RootProps {
  coreRoot: CoreRoot,
  +dispatch: Dispatch<any>,
  io: FixedIo,
  onError(e: Error): void,
  output: RootOutput | void,
  plugins: Array<AbcCorePlugin>,
  state: RootState
}

export const rootPixie = combinePixies({
  currencyPlugins,
  exchangePlugins,
  tempPluginsDispatch,
  exchangePixie
})

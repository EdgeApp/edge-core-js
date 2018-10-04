// @flow

import { buildReducer, mapReducer } from 'redux-keto'

import { type EdgeCurrencyInfo, type EdgeTokenInfo } from '../../index.js'
import { type RootAction } from '../actions.js'
import { type RootState } from '../root-reducer.js'
import {
  type CurrencyWalletState,
  currencyWalletReducer
} from './wallet/currency-wallet-reducer.js'

export type PluginSettings = { [pluginName: string]: Object }

export type CurrencyState = {
  +currencyWalletIds: Array<string>,
  +customTokens: Array<EdgeTokenInfo>,
  +infos: Array<EdgeCurrencyInfo>,
  +pluginsError: Error | null,
  +settings: PluginSettings,
  +wallets: { [walletId: string]: CurrencyWalletState }
}

export const currency = buildReducer({
  currencyWalletIds (state, action, next: RootState): Array<string> {
    // Optimize the common case:
    if (next.accountIds.length === 1) {
      const id = next.accountIds[0]
      return next.accounts[id].activeWalletIds
    }

    const allIds = next.accountIds.map(
      accountId => next.accounts[accountId].activeWalletIds
    )
    return [].concat(...allIds)
  },

  customTokens (state = [], action: RootAction): Array<EdgeTokenInfo> {
    if (action.type === 'ADDED_CUSTOM_TOKEN') {
      const currencyCode = action.payload.currencyCode
      const out = state.filter(info => info.currencyCode !== currencyCode)
      out.push(action.payload)
      return out
    }
    return state
  },

  infos (state = [], action: RootAction): Array<EdgeCurrencyInfo> {
    return action.type === 'CURRENCY_PLUGINS_LOADED' ? action.payload : state
  },

  pluginsError (state = null, action: RootAction): Error | null {
    return action.type === 'CURRENCY_PLUGINS_FAILED' ? action.payload : state
  },

  settings (state = {}, action: RootAction): PluginSettings {
    switch (action.type) {
      case 'CHANGED_CURRENCY_PLUGIN_SETTING':
        const { pluginName, settings } = action.payload
        const out = { ...state }
        out[pluginName] = settings
        return out

      case 'NEW_CURRENCY_PLUGIN_SETTINGS':
        return action.payload
    }
    return state
  },

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

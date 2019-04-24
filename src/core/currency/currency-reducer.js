// @flow

import { buildReducer, mapReducer, memoizeReducer } from 'redux-keto'

import {
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeMetaToken,
  type EdgePluginMap
} from '../../types/types.js'
import { type RootAction } from '../actions.js'
import { type RootState } from '../root-reducer.js'
import {
  type CurrencyWalletState,
  currencyWalletReducer
} from './wallet/currency-wallet-reducer.js'

export type CurrencyState = {
  +currencyWalletIds: Array<string>,
  +customTokens: Array<EdgeMetaToken>,
  +infos: Array<EdgeCurrencyInfo>,
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

  customTokens (state = [], action: RootAction): Array<EdgeMetaToken> {
    if (action.type === 'ADDED_CUSTOM_TOKEN') {
      const {
        currencyCode,
        currencyName,
        contractAddress,
        multiplier
      } = action.payload
      const token = {
        currencyCode,
        currencyName,
        contractAddress,
        denominations: [
          {
            name: currencyCode,
            multiplier
          }
        ]
      }
      const out = state.filter(info => info.currencyCode !== currencyCode)
      out.push(token)
      return out
    }
    return state
  },

  infos: memoizeReducer(
    (state: RootState) => state.plugins.currency,
    (plugins: EdgePluginMap<EdgeCurrencyPlugin>) => {
      const out: Array<EdgeCurrencyInfo> = []
      for (const pluginName in plugins) {
        out.push(plugins[pluginName].currencyInfo)
      }
      return out
    }
  ),

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

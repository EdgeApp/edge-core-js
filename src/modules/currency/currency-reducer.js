// @flow

import { buildReducer, mapReducer } from 'redux-keto'

import type { EdgeCurrencyInfo, EdgeTokenInfo } from '../../edge-core-index.js'
import type { RootAction } from '../actions.js'
import type { RootState } from '../root-reducer.js'
import type { CurrencyWalletState } from './wallet/currency-wallet-reducer.js'
import currencyWalletReducer from './wallet/currency-wallet-reducer.js'

export interface CurrencyState {
  currencyWalletIds: Array<string>;
  customTokens: Array<EdgeTokenInfo>;
  infos: Array<EdgeCurrencyInfo>;
  pluginsError: Error | null;
  wallets: { [walletId: string]: CurrencyWalletState };
}

export default buildReducer({
  currencyWalletIds (state, action, next: RootState) {
    // Optimize the common case:
    if (next.login.activeLoginIds.length === 1) {
      const id = next.login.activeLoginIds[0]
      return next.login.logins[id].activeWalletIds
    }

    const allIds = next.login.activeLoginIds.map(
      activeLoginId => next.login.logins[activeLoginId].activeWalletIds
    )
    return [].concat(...allIds)
  },

  customTokens (
    state: Array<EdgeTokenInfo> = [],
    action: RootAction
  ): Array<EdgeTokenInfo> {
    if (action.type === 'ADDED_CUSTOM_TOKEN') {
      const currencyCode = action.payload.currencyCode
      const out = state.filter(info => info.currencyCode !== currencyCode)
      out.push(action.payload)
      return out
    }
    return state
  },

  infos (
    state: Array<EdgeCurrencyInfo> = [],
    action: RootAction
  ): Array<EdgeCurrencyInfo> {
    return action.type === 'CURRENCY_PLUGINS_LOADED' ? action.payload : state
  },

  pluginsError (state = null, action: RootAction) {
    return action.type === 'CURRENCY_PLUGINS_FAILED' ? action.payload : state
  },

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

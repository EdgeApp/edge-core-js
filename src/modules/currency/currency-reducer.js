// @flow
import { buildReducer, mapReducer } from 'redux-keto'

import type { AbcCurrencyInfo } from '../../edge-core-index.js'
import type { RootAction } from '../actions.js'
import type { RootState } from '../root-reducer.js'
import type { CurrencyWalletState } from './wallet/currency-wallet-reducer.js'
import currencyWalletReducer from './wallet/currency-wallet-reducer.js'

export interface CurrencyState {
  currencyWalletIds: Array<string>;
  infos: Array<AbcCurrencyInfo>;
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

  infos (
    state: Array<AbcCurrencyInfo> = [],
    action: RootAction
  ): Array<AbcCurrencyInfo> {
    return action.type === 'CURRENCY_PLUGINS_LOADED' ? action.payload : state
  },

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

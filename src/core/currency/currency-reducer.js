// @flow

import { type FatReducer, buildReducer, mapReducer } from 'redux-keto'

import { type RootAction } from '../actions.js'
import { type RootState } from '../root-reducer.js'
import {
  type CurrencyWalletState,
  currencyWalletReducer
} from './wallet/currency-wallet-reducer.js'

export type CurrencyState = {
  +currencyWalletIds: string[],
  +wallets: { [walletId: string]: CurrencyWalletState }
}

export const currency: FatReducer<
  CurrencyState,
  RootAction,
  RootState
> = buildReducer({
  currencyWalletIds(state, action: RootAction, next: RootState): string[] {
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

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

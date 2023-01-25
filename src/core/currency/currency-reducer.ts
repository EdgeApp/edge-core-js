import { buildReducer, FatReducer, mapReducer } from 'redux-keto'

import { RootAction } from '../actions'
import { RootState } from '../root-reducer'
import {
  currencyWalletReducer,
  CurrencyWalletState
} from './wallet/currency-wallet-reducer'

export interface CurrencyState {
  readonly currencyWalletIds: string[]
  readonly wallets: { [walletId: string]: CurrencyWalletState }
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

    const out: string[] = []
    for (const accountId of next.accountIds) {
      out.push(...next.accounts[accountId].activeWalletIds)
    }
    return out
  },

  wallets: mapReducer(
    currencyWalletReducer,
    (props: RootState) => props.currency.currencyWalletIds
  )
})

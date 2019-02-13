// @flow

import { type TamePixie, combinePixies, mapPixie } from 'redux-pixies'

import { type RootProps } from '../root-pixie.js'
import {
  type CurrencyWalletOutput,
  type CurrencyWalletProps,
  walletPixie
} from './wallet/currency-wallet-pixie.js'

export type CurrencyOutput = {
  +wallets: { [walletId: string]: CurrencyWalletOutput }
}

export const currency: TamePixie<RootProps> = combinePixies({
  wallets: mapPixie(
    walletPixie,
    (props: RootProps) => props.state.currency.currencyWalletIds,
    (props: RootProps, id: string): CurrencyWalletProps => ({
      ...props,
      id,
      selfState: props.state.currency.wallets[id],
      selfOutput: props.output.currency.wallets[id]
    })
  )
})

import { combinePixies, mapPixie, TamePixie } from 'redux-pixies'

import { RootProps } from '../root-pixie'
import {
  CurrencyWalletOutput,
  CurrencyWalletProps,
  walletPixie
} from './wallet/currency-wallet-pixie'

export interface CurrencyOutput {
  readonly wallets: { [walletId: string]: CurrencyWalletOutput }
}

export const currency: TamePixie<RootProps> = combinePixies({
  wallets: mapPixie(
    walletPixie,
    (props: RootProps) => props.state.currency.currencyWalletIds,
    (props: RootProps, walletId: string): CurrencyWalletProps => ({
      ...props,
      walletId,
      walletState: props.state.currency.wallets[walletId],
      walletOutput: props.output.currency.wallets[walletId]
    })
  )
})

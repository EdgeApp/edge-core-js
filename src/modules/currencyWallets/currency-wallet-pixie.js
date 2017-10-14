// @flow
import type { AbcWalletInfo } from 'airbitz-core-types'
import { mapPixie, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'
import type { ActiveLoginState } from '../login/active/active-login-reducer.js'
import type { RootProps } from '../root.js'
import { addCurrencyWallet } from './actions.js'

interface TempProps extends RootProps {
  login: ActiveLoginState;
}

interface CurrencyWalletProps extends RootProps {
  walletInfo: AbcWalletInfo;
}

function walletPixie (input: PixieInput<CurrencyWalletProps>) {
  return {
    async update (props: CurrencyWalletProps) {
      try {
        await props.dispatch(addCurrencyWallet(props.walletInfo, input))
      } catch (e) {
        e.message += ` (wallet ${props.walletInfo.id})`
        input.props.onError(e)
      }
      return stopUpdates
    },

    destroy () {}
  }
}

// Spread the wallet pixie over all accounts and wallets:
export default mapPixie(
  mapPixie(
    walletPixie,
    ({ login }: TempProps) => login.currencyWalletIds,
    (props: TempProps, id: string): CurrencyWalletProps =>
      ({
        ...props,
        walletInfo: props.login.allWalletInfos[id]
      }: any)
  ),
  ({ state }: RootProps) => state.login.activeLoginIds,
  (props: RootProps, id): TempProps => ({
    ...props,
    login: props.state.login.logins[id]
  })
)

// @flow

import { combinePixies, mapPixie, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'

import type { EdgeCurrencyPlugin } from '../../edge-core-index.js'
import type { RootProps } from '../root.js'
import type {
  CurrencyWalletOutput,
  CurrencyWalletProps
} from './wallet/currency-wallet-pixie.js'
import walletPixie from './wallet/currency-wallet-pixie.js'

export interface CurrencyOutput {
  plugins: Array<EdgeCurrencyPlugin>;
  wallets: { [walletId: string]: CurrencyWalletOutput };
}

export default combinePixies({
  plugins (input: PixieInput<RootProps>) {
    return (props: RootProps): any => {
      const opts = { io: (props.io: any) }
      const promises: Array<Promise<EdgeCurrencyPlugin>> = []
      for (const plugin of props.plugins) {
        if (plugin.pluginType === 'currency') {
          promises.push(plugin.makePlugin(opts))
        }
      }

      return Promise.all(promises).then(plugins => {
        input.onOutput(plugins)
        input.props.dispatch({
          type: 'CURRENCY_PLUGINS_LOADED',
          payload: plugins.map(plugin => plugin.currencyInfo)
        })

        return stopUpdates
      })
    }
  },

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

// @flow

import { downgradeDisklet } from 'disklet'
import {
  type PixieInput,
  type TamePixie,
  combinePixies,
  mapPixie,
  stopUpdates
} from 'redux-pixies'

import { type EdgeCurrencyPlugin } from '../../types/types.js'
import { type RootProps } from '../root-pixie.js'
import {
  type CurrencyWalletOutput,
  type CurrencyWalletProps,
  walletPixie
} from './wallet/currency-wallet-pixie.js'

export type CurrencyOutput = {
  +plugins: Array<EdgeCurrencyPlugin>,
  +wallets: { [walletId: string]: CurrencyWalletOutput }
}

export const currency: TamePixie<RootProps> = combinePixies({
  plugins (input: PixieInput<RootProps>) {
    return (props: RootProps): mixed => {
      const promises: Array<Promise<EdgeCurrencyPlugin>> = []
      for (const plugin of props.plugins) {
        try {
          if (plugin.pluginType === 'currency') {
            const opts = {
              io: { ...props.io, folder: downgradeDisklet(props.io.disklet) }
            }
            promises.push(plugin.makePlugin(opts))
          }
        } catch (e) {
          promises.push(Promise.reject(e))
        }
      }

      return Promise.all(promises)
        .then(plugins => {
          input.onOutput(plugins)
          input.props.dispatch({
            type: 'CURRENCY_PLUGINS_LOADED',
            payload: plugins.map(plugin => plugin.currencyInfo)
          })
          return stopUpdates
        })
        .catch(e => {
          input.props.dispatch({
            type: 'CURRENCY_PLUGINS_FAILED',
            payload: e
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

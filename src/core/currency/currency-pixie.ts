import { combinePixies, mapPixie, TamePixie } from 'redux-pixies'

import { matchJson } from '../../util/match-json'
import { InfoCacheFile } from '../context/info-cache-file'
import { ApiInput, RootProps } from '../root-pixie'
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
  ),

  pluginUpdater(input: ApiInput) {
    let lastInfo: InfoCacheFile | undefined

    return async () => {
      const { infoCache, plugins } = input.props.state

      // Bail out quickly if nothing has changed:
      if (lastInfo === infoCache) return

      // Update plugins after the first run:
      if (lastInfo != null) {
        for (const pluginId of Object.keys(plugins.currency)) {
          const plugin = plugins.currency[pluginId]
          const newPayload = infoCache.corePlugins?.[pluginId] ?? {}
          const oldPayload = lastInfo.corePlugins?.[pluginId] ?? {}

          if (
            plugin.updateInfoPayload != null &&
            !matchJson(oldPayload, newPayload)
          ) {
            await plugin.updateInfoPayload(newPayload)
          }
        }
      }
      lastInfo = infoCache
    }
  }
})

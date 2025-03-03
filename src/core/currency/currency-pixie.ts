import { combinePixies, mapPixie, TamePixie } from 'redux-pixies'

import { matchJson } from '../../util/match-json'
import { InfoCacheFile } from '../context/info-cache-file'
import { ApiInput, RootProps } from '../root-pixie'
import {
  ChangeServerConnection,
  connectChangeServer
} from './change-server-connection'
import {
  CurrencyWalletOutput,
  CurrencyWalletProps,
  walletPixie
} from './wallet/currency-wallet-pixie'
import { CurrencyWalletState } from './wallet/currency-wallet-reducer'

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
  },

  changeSocket(input: ApiInput) {
    let lastWallets: { [walletId: string]: CurrencyWalletState } | undefined
    let socket: ChangeServerConnection | undefined

    return async () => {
      // Grab the wallet state, and bail out if there are no changes:
      const { wallets } = input.props.state.currency
      if (wallets === lastWallets) return
      lastWallets = wallets

      const subs = new Set()

      // Diff the wallet state with the current subscriptions:
      // todo

      // Connect the socket if we have 1 or more subscriptions:
      if (socket == null && subs.size > 1) {
        socket = connectChangeServer('wss://change1.edge.app', {
          handleChange() {
            // Send to wallets!
          },
          handleClose() {
            // TODO: Reconnect logic
          },
          handleConnect() {
            // Do we even care?
          }
        })
      }

      // Disconnect the socket if we have 0 subscriptions:
      if (socket != null && subs.size === 0) {
        socket.close()
        socket = undefined
      }

      // Subscribe what's new:
      if (socket?.connected === true) await socket.subscribe([])

      // Unsubscribe what's gone:
      if (socket?.connected === true) await socket.unsubscribe([])
    }
  }
})

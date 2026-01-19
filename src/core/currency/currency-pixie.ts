import { combinePixies, mapPixie, TamePixie } from 'redux-pixies'

import { matchJson } from '../../util/match-json'
import { InfoCacheFile } from '../context/info-cache-file'
import { ApiInput, RootProps } from '../root-pixie'
import {
  ChangeServerConnection,
  connectChangeServer
} from './change-server-connection'
import { SubscribeParams, SubscribeResult } from './change-server-protocol'
import {
  CurrencyWalletOutput,
  CurrencyWalletProps,
  walletPixie
} from './wallet/currency-wallet-pixie'
import {
  ChangeServiceSubscription,
  ChangeServiceSubscriptionStatus,
  CurrencyWalletState
} from './wallet/currency-wallet-reducer'

// Timeout for change-server subscription responses before enabling polling fallback
const CHANGE_SERVER_SUBSCRIPTION_TIMEOUT_MS = 15000

export interface CurrencyOutput {
  readonly wallets: { [walletId: string]: CurrencyWalletOutput }
  readonly changeServiceManager:
    | {
        changeService: ChangeServerConnection | undefined
        changeServiceConnected: boolean
      }
    | undefined
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

  changeServiceManager(input: ApiInput) {
    let lastWallets: { [walletId: string]: CurrencyWalletState } | undefined
    let subscriptionTimeoutId: ReturnType<typeof setTimeout> | undefined

    return {
      async update() {
        const { wallets } = input.props.state.currency

        // Memoize this function using the wallet state:
        if (wallets === lastWallets) {
          return
        } else {
          lastWallets = wallets
        }

        let { changeService, changeServiceConnected = false } =
          input.props.output.currency.changeServiceManager ?? {}

        // The viable wallets that support change server subscriptions
        const supportedWallets = Object.entries(wallets).filter(([, wallet]) =>
          wallet.changeServiceSubscriptions.some(
            subscription => subscription.status !== 'avoiding'
          )
        )

        // Connect the socket if we have 1 or more supported wallets:
        if (changeService == null && supportedWallets.length > 0) {
          const url = input.props.state.changeServers[0]
          changeService = connectChangeServer(url, {
            handleChange([pluginId, address, checkpoint]) {
              const wallets = Object.entries(input.props.state.currency.wallets)
              const filteredWallets = wallets.filter(([, wallet]) => {
                return (
                  wallet.currencyInfo.pluginId === pluginId &&
                  wallet.changeServiceSubscriptions.some(
                    subscription => subscription.address === address
                  )
                )
              })
              for (const [walletId, wallet] of filteredWallets) {
                const subscriptions = wallet.changeServiceSubscriptions
                  .filter(
                    subscription =>
                      subscription.address === address &&
                      subscription.status === 'listening'
                  )
                  .map(subscription => ({
                    ...subscription,
                    status: 'syncing' as const,
                    checkpoint
                  }))
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
                  payload: {
                    walletId,
                    subscriptions
                  }
                })
              }
            },
            handleConnect() {
              const wallets = Object.entries(input.props.state.currency.wallets)
              // Reset to subscribing status for all reconnecting wallets:
              for (const [walletId, wallet] of wallets) {
                const subscriptions = wallet.changeServiceSubscriptions
                  .filter(
                    subscription => subscription.status === 'reconnecting'
                  )
                  .map(subscription => ({
                    ...subscription,
                    status: 'subscribing' as const
                  }))
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
                  payload: {
                    walletId,
                    subscriptions
                  }
                })
              }
              // Start subscribing for all supported wallets:
              input.onOutput({ changeService, changeServiceConnected: true })
            },
            handleDisconnect() {
              const wallets = Object.entries(input.props.state.currency.wallets)
              // Reset to reconnecting status for all supported wallets:
              for (const [walletId, wallet] of wallets) {
                const subscriptions = wallet.changeServiceSubscriptions
                  .filter(subscription => subscription.status !== 'avoiding')
                  .map(subscription => ({
                    ...subscription,
                    status: 'reconnecting' as const
                  }))
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
                  payload: {
                    walletId,
                    subscriptions
                  }
                })
              }
              input.onOutput({ changeService, changeServiceConnected: false })
            },
            handleSubLost([pluginId, address]) {
              const wallets = Object.entries(input.props.state.currency.wallets)
              const filteredWallets = wallets.filter(
                ([, wallet]) =>
                  // Wallet must be for the same plugin, because those wallets,
                  wallet.currencyInfo.pluginId === pluginId &&
                  // Wallet must have a subscription for the address:
                  wallet.changeServiceSubscriptions.some(
                    subscription => subscription.address === address
                  ) &&
                  // Wallet subscription not be avoiding the change service
                  // because those wallets shouldn't be affected by this event:
                  wallet.changeServiceSubscriptions.some(
                    subscription => subscription.status !== 'avoiding'
                  )
              )
              // Set status back to subscribing for all filtered wallets:
              for (const [walletId, wallet] of filteredWallets) {
                const subscriptions: ChangeServiceSubscription[] =
                  wallet.changeServiceSubscriptions
                    .filter(subscription => subscription.status !== 'avoiding')
                    .map(subscription => ({
                      ...subscription,
                      status: 'subscribing' as const
                    }))
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
                  payload: {
                    walletId,
                    subscriptions
                  }
                })
              }
            }
          })
          input.onOutput({ changeService, changeServiceConnected: false })
        }

        // Disconnect the socket if we have 0 supported wallets:
        if (changeService != null && supportedWallets.length === 0) {
          changeService.close()
          changeService = undefined
          input.onOutput({ changeService, changeServiceConnected: false })
        }

        // Subscribe wallets to the change service:
        if (changeService?.connected === true && changeServiceConnected) {
          const filteredWallets = supportedWallets.filter(([, wallet]) =>
            wallet.changeServiceSubscriptions.some(
              subscription =>
                subscription.status === 'subscribing' ||
                subscription.status === 'resubscribing'
            )
          )
          const indexToWalletId: Array<{
            walletId: string
            wallet: CurrencyWalletState
          }> = []
          const batches: SubscribeParams[][] = []
          for (const [walletId, wallet] of filteredWallets) {
            if (wallet.paused) continue

            // Build the subscribe parameters:
            const params = wallet.changeServiceSubscriptions.map(
              (subscription): SubscribeParams => [
                wallet.currencyInfo.pluginId,
                subscription.address,
                subscription.checkpoint
              ]
            )
            if (params.length === 0) continue
            let subscribeParams = batches[batches.length - 1]
            if (
              subscribeParams == null ||
              subscribeParams.length + params.length > 100
            ) {
              batches.push([])
              subscribeParams = batches[batches.length - 1]
            }
            subscribeParams.push(...params)
            for (let i = 0; i < params.length; i++) {
              indexToWalletId[indexToWalletId.length] = { walletId, wallet }
            }
          }

          // Start timeout that enables polling after a timeout period without
          // response:
          subscriptionTimeoutId = setTimeout(() => {
            subscriptionTimeoutId = undefined
            const walletIds = new Set(
              indexToWalletId.map(item => item.walletId)
            )
            for (const walletId of walletIds) {
              // Using input.props.state.currency directly because it's mutable:
              const wallet = input.props.state.currency.wallets[walletId]
              // Skip if wallet was removed during timeout:
              if (wallet == null) continue
              const subscriptions = wallet.changeServiceSubscriptions
                .filter(s => s.status === 'subscribing')
                .map(s => ({ ...s, status: 'subscribingSlowly' as const }))
              if (subscriptions.length > 0) {
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
                  payload: { walletId, subscriptions }
                })
              }
            }
          }, CHANGE_SERVER_SUBSCRIPTION_TIMEOUT_MS)

          // Subscribe to the change service:
          const results: SubscribeResult[] = []
          try {
            for (const subscribeParams of batches) {
              const r: SubscribeResult[] = await changeService
                .subscribe(subscribeParams)
                .catch(err => {
                  input.props.log(`Failed to subscribe: ${String(err)}`)
                  return [0] as SubscribeResult[]
                })
              results.push(...r)
            }
          } finally {
            clearTimeout(subscriptionTimeoutId)
            subscriptionTimeoutId = undefined
          }

          const subscriptionUpdates: Map<string, ChangeServiceSubscription[]> =
            new Map()
          for (let i = 0; i < results.length; i++) {
            const result = results[i]
            const { walletId } = indexToWalletId[i]
            // Using input.props.state.currency directly because it's mutable:
            const wallet = input.props.state.currency.wallets[walletId]

            // Skip if wallet was removed during await:
            if (wallet == null) continue

            // Determine the new status of the subscription to all addresses
            // for the wallet:
            let status: ChangeServiceSubscriptionStatus
            switch (result) {
              // Change server does not support this wallet plugin:
              case -1:
                // Avoid the change service:
                status = 'avoiding'
                break
              // Change server does support this wallet plugin, but failed to
              // subscribe to the address:
              case 0:
                // Try subscribing again later:
                status = 'resubscribing'
                break
              // Change server does support this wallet plugin, and there are no
              // changes for the address:
              case 1:
                // Start syncing the wallet once for initial syncNetwork call:
                status = 'synced'
                break
              // Change server does support this wallet plugin, and there are
              // changes for the address:
              case 2:
                // Start syncing the wallet:
                status = 'syncing'
                break
            }

            // Update the status for the subscription:
            const subscriptions = wallet.changeServiceSubscriptions
              .filter(
                subscription =>
                  subscription.status === 'subscribing' ||
                  subscription.status === 'subscribingSlowly' ||
                  subscription.status === 'resubscribing'
              )
              .map(subscription => ({
                ...subscription,
                status
              }))
            subscriptionUpdates.set(walletId, subscriptions)
          }

          // TODO: Remove the Array.from() once we drop ES5 targeting. This is
          // need to avoid iterables because looping over iterables are broken
          // for ES5 targets.
          const entries = Array.from(subscriptionUpdates.entries())

          for (const [walletId, subscriptions] of entries) {
            input.props.dispatch({
              type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
              payload: {
                walletId,
                subscriptions
              }
            })
          }
        }
      },

      destroy() {
        if (subscriptionTimeoutId != null) {
          clearTimeout(subscriptionTimeoutId)
        }
      }
    }
  }
})

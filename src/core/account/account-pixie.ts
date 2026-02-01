import {
  combinePixies,
  filterPixie,
  mapPixie,
  PixieInput,
  stopUpdates,
  TamePixie
} from 'redux-pixies'
import { close, update } from 'yaob'

import {
  asMaybeOtpError,
  EdgeAccount,
  EdgeCurrencyWallet,
  EdgePluginMap,
  EdgeTokenMap
} from '../../types/types'
import { makePeriodicTask, PeriodicTask } from '../../util/periodic-task'
import { snooze } from '../../util/snooze'
import { loadWalletCache } from '../cache/cache-wallet-loader'
import { makeWalletCacheSaver } from '../cache/cache-wallet-saver'
import { syncLogin } from '../login/login'
import { waitForPlugins } from '../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../root-pixie'
import {
  addStorageWallet,
  SYNC_INTERVAL,
  syncStorageWallet
} from '../storage/storage-actions'
import { makeAccountApi, makeAccountApiWithCachedWallets } from './account-api'
import { loadAllWalletStates, reloadPluginSettings } from './account-files'
import { AccountState, initialCustomTokens } from './account-reducer'
import {
  loadBuiltinTokens,
  loadCustomTokens,
  saveCustomTokens
} from './custom-tokens'

export const EXPEDITED_SYNC_INTERVAL = 5000

export interface AccountOutput {
  readonly accountApi: EdgeAccount
  readonly currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
}

export type AccountProps = RootProps & {
  readonly accountId: string
  readonly accountState: AccountState
  readonly accountOutput: AccountOutput
}

export type AccountInput = PixieInput<AccountProps>

const accountPixie: TamePixie<AccountProps> = combinePixies({
  accountApi(input: AccountInput) {
    return {
      destroy() {
        // The Pixie library stops updating props after destruction,
        // so we are stuck seeing the logged-in state. Fix that:
        const hack: any = input.props
        hack.state = { accounts: {} }

        const { accountOutput } = input.props
        if (accountOutput == null) return
        const { accountApi } = accountOutput
        if (accountApi == null) return

        update(accountApi)
        close(accountApi)
        close(accountApi.dataStore)
        const { currencyConfig, swapConfig } = accountApi
        for (const pluginId of Object.keys(currencyConfig)) {
          close(currencyConfig[pluginId])
        }
        for (const pluginId of Object.keys(swapConfig)) {
          close(swapConfig[pluginId])
        }
      },

      async update() {
        const ai = toApiInput(input)
        const { accountId, accountState, log, state } = input.props
        const { accountWalletInfos } = accountState

        async function loadAllFiles(): Promise<void> {
          await Promise.all([
            loadAllWalletStates(ai, accountId),
            loadCustomTokens(ai, accountId),
            reloadPluginSettings(ai, accountId)
          ])
        }

        // Try to load wallet cache for instant UI:
        async function tryLoadCache(): Promise<boolean> {
          try {
            const storageWalletId = accountWalletInfos[0]?.id
            if (storageWalletId == null) {
              return false
            }

            const cachePath = `accountCache/${storageWalletId}/walletCache.json`
            const cacheJson = await ai.props.io.disklet.getText(cachePath)

            // Build currency info map from loaded plugins:
            const currencyInfos: {
              [pluginId: string]: import('../../types/types').EdgeCurrencyInfo
            } = {}
            for (const pluginId of Object.keys(state.plugins.currency)) {
              currencyInfos[pluginId] =
                state.plugins.currency[pluginId].currencyInfo
            }

            // Create cached wallets:
            const cacheSetup = loadWalletCache(cacheJson, currencyInfos)
            log.warn(
              `Login: loaded ${cacheSetup.activeWalletIds.length} wallets from cache`
            )

            // Dispatch subscription data to Redux for change server
            for (const sub of cacheSetup.walletSubscriptions) {
              input.props.dispatch({
                type: 'CURRENCY_WALLET_LOADED_SUBSCRIBED_ADDRESSES',
                payload: {
                  walletId: sub.walletId,
                  subscribedAddresses: sub.subscribedAddresses.map(addr => ({
                    address: addr.address,
                    status: 'subscribing' as const,
                    checkpoint: addr.checkpoint
                  }))
                }
              })
            }

            // Initialize storage wallet FIRST to get real disklets working
            // (storage wallets are just file system access, don't need engines)
            const accountStorageWalletInfo = accountWalletInfos[0]
            if (accountStorageWalletInfo != null) {
              await addStorageWallet(ai, accountStorageWalletInfo)
              log.warn('Login: initialized account storage wallet for cache mode')
            }

            // Create the API object with cached wallets:
            input.onOutput(
              makeAccountApiWithCachedWallets(ai, accountId, cacheSetup)
            )
            return true
          } catch (err) {
            // Cache doesn't exist or failed to load, continue with normal flow
            return false
          }
        }

        try {
          await waitForPlugins(ai)
          log.warn('Login: plugins loaded')

          // Try cache-first login for instant UI:
          const cacheLoaded = await tryLoadCache()
          if (cacheLoaded) {
            log.warn('Login: complete (from cache)')
            return await stopUpdates
          }

          // Normal login flow (no cache available):
          await loadBuiltinTokens(ai, accountId)
          log.warn('Login: currency plugins exist')

          // Start the repo:
          await Promise.all(
            accountWalletInfos.map(info => addStorageWallet(ai, info))
          )
          log.warn('Login: synced account repos')

          await loadAllFiles()
          log.warn('Login: loaded files')

          // Create the API object:
          input.onOutput(makeAccountApi(ai, accountId))
          log.warn('Login: complete')
        } catch (error: unknown) {
          input.props.dispatch({
            type: 'ACCOUNT_LOAD_FAILED',
            payload: { accountId, error }
          })
        }

        return await stopUpdates
      }
    }
  },

  // Starts & stops the sync timer for this account:
  syncTimer: filterPixie(
    (input: AccountInput) => {
      async function doDataSync(): Promise<void> {
        const ai = toApiInput(input)
        const { accountId, accountState } = input.props
        const { accountWalletInfos } = accountState

        if (input.props.state.accounts[accountId] == null) return
        const changeLists = await Promise.all(
          accountWalletInfos.map(info => syncStorageWallet(ai, info.id))
        )
        const changes: string[] = []
        for (const list of changeLists) changes.push(...list)
        if (changes.length > 0) {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])
        }
      }

      async function doLoginSync(): Promise<void> {
        const ai = toApiInput(input)
        const { accountId } = input.props
        if (input.props.state.accounts[accountId] == null) return
        const { sessionKey } = input.props.state.accounts[accountId]
        await syncLogin(ai, sessionKey)
      }

      // We don't report sync failures, since that could be annoying:
      const dataTask = makePeriodicTask(doDataSync, SYNC_INTERVAL)
      const loginTask = makePeriodicTask(doLoginSync, SYNC_INTERVAL, {
        onError(error) {
          // Only send OTP errors to the GUI:
          const otpError = asMaybeOtpError(error)
          if (otpError != null) input.props.onError(otpError)
        }
      })

      return {
        update() {
          if (input.props.accountOutput?.accountApi == null) return

          const { accountId } = input.props
          const { stashTree } = input.props.state.accounts[accountId]

          // Speed up the login-stash sync interval while there is a WIP change:
          const loginInterval =
            stashTree.wipChange != null
              ? EXPEDITED_SYNC_INTERVAL
              : SYNC_INTERVAL

          dataTask.setDelay(SYNC_INTERVAL)
          loginTask.setDelay(loginInterval)

          // Start once the EdgeAccount API exists:
          dataTask.start({ wait: SYNC_INTERVAL * (1 + Math.random()) })
          loginTask.start({ wait: loginInterval * (1 + Math.random()) })
        },

        destroy() {
          dataTask.stop()
          loginTask.stop()
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  /**
   * Watches for changes to the token state, and writes those to disk.
   *
   * The pixie system ensures that multiple `update` calls will not occur
   * at once. This way, if the GUI makes dozens of calls to `addCustomToken`,
   * we will consolidate those down to a single write to disk.
   */
  tokenSaver(input: AccountInput) {
    let lastTokens: EdgePluginMap<EdgeTokenMap> = initialCustomTokens

    return async function update() {
      const { accountId, accountState } = input.props

      const { customTokens } = accountState
      if (customTokens !== lastTokens && lastTokens !== initialCustomTokens) {
        await saveCustomTokens(toApiInput(input), accountId).catch(error =>
          input.props.onError(error)
        )
        await snooze(100) // Rate limiting
      }
      lastTokens = customTokens
    }
  },

  /**
   * Auto-saves the wallet cache with throttling (every 5 seconds at most).
   * Watches for changes in wallet balances, names, tokens, and subscriptions.
   */
  cacheSaver: filterPixie(
    (input: AccountInput) => {
      const CACHE_SAVE_INTERVAL = 5000 // 5 seconds
      let cacheSaver: ReturnType<typeof makeWalletCacheSaver> | undefined
      let cacheTask: PeriodicTask | undefined
      const lastWalletStates: { [walletId: string]: unknown } = {}

      function checkForChanges(): void {
        const { state, accountOutput } = input.props
        const accountApi = accountOutput?.accountApi
        if (accountApi == null) return

        // Check if any wallet state has changed
        let hasChanges = false
        for (const walletId of accountApi.activeWalletIds) {
          const walletState = state.currency.wallets[walletId]
          if (
            walletState != null &&
            lastWalletStates[walletId] !== walletState
          ) {
            hasChanges = true
            lastWalletStates[walletId] = walletState
          }
        }

        if (hasChanges && cacheSaver != null) {
          cacheSaver.markDirty()
        }
      }

      return {
        update() {
          const ai = toApiInput(input)
          const { accountOutput, accountState, state } = input.props
          const accountApi = accountOutput?.accountApi

          // Initialize cache saver once account API exists
          if (accountApi != null && cacheSaver == null) {
            const storageWalletId = accountState.accountWalletInfos[0]?.id
            if (storageWalletId != null) {
              const cachePath = `accountCache/${storageWalletId}/walletCache.json`

              cacheSaver = makeWalletCacheSaver(
                accountApi,
                ai.props.io.disklet,
                cachePath,
                // Get subscriptions from Redux state
                (walletId: string) => {
                  const walletState = state.currency.wallets[walletId]
                  return (
                    walletState?.changeServiceSubscriptions
                      ?.filter(sub => sub.status !== 'avoiding')
                      .map(sub => ({
                        address: sub.address,
                        checkpoint: sub.checkpoint
                      })) ?? []
                  )
                },
                // Get seen tx checkpoint
                (walletId: string) =>
                  state.currency.wallets[walletId]?.seenTxCheckpoint ?? null
              )
            }
          }

          // Start periodic check for changes
          if (cacheTask == null) {
            cacheTask = makePeriodicTask(async () => {
              checkForChanges()
            }, CACHE_SAVE_INTERVAL)
            cacheTask.start({ wait: CACHE_SAVE_INTERVAL })
          }
        },

        destroy() {
          if (cacheTask != null) {
            cacheTask.stop()
            cacheTask = undefined
          }
          if (cacheSaver != null) {
            cacheSaver.stop()
            cacheSaver = undefined
          }
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  watcher(input: AccountInput) {
    let lastState: AccountState | undefined

    return () => {
      const { accountState, accountOutput } = input.props
      if (accountState == null || accountOutput == null) return
      const { accountApi } = accountOutput

      // TODO: Remove this once update detection is reliable:
      if (accountApi != null) update(accountApi)

      // General account state:
      if (lastState !== accountState) {
        lastState = accountState
        if (accountApi != null) {
          // TODO: Put this back once we solve the race condition:
          // update(accountApi)
          const { currencyConfig, swapConfig } = accountApi
          for (const pluginId of Object.keys(currencyConfig)) {
            update(currencyConfig[pluginId])
          }
          for (const pluginId of Object.keys(swapConfig)) {
            update(swapConfig[pluginId])
          }
        }
      }

      // Wallet list:
      // TODO: Why don't we always detect `currencyWallets` updates?
      // if (lastWallets !== input.props.output.currency.wallets) {
      //   lastWallets = input.props.output.currency.wallets
      //   if (accountOutput.accountApi != null) update(accountOutput.accountApi)
      // }
    }
  },

  currencyWallets(input: AccountInput) {
    let lastActiveWalletIds: string[]
    let cacheOutputted = false

    return () => {
      const { accountOutput, accountState } = input.props
      const { activeWalletIds } = accountState
      const { wallets: currencyWallets } = input.props.output.currency

      // Detect cache mode: accountApi has wallets but currency pixie doesn't
      const accountApi = accountOutput?.accountApi
      const hasCachedWallets =
        accountApi != null &&
        Object.keys(accountApi.currencyWallets).length > 0 &&
        Object.keys(currencyWallets).length === 0

      // In cache mode, get wallets from the accountApi instead of currency pixie:
      if (hasCachedWallets) {
        if (!cacheOutputted) {
          // Output cached wallets from the accountApi:
          input.onOutput(accountApi.currencyWallets)
          cacheOutputted = true
        }
        return
      }

      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut: { [walletId: string]: EdgeCurrencyWallet } = {}
      if (accountOutput?.currencyWallets != null) {
        lastOut = accountOutput.currencyWallets
      }

      const out: { [walletId: string]: EdgeCurrencyWallet } = {}
      for (const walletId of activeWalletIds) {
        const api = currencyWallets[walletId]?.walletApi
        if (api !== lastOut[walletId]) dirty = true
        if (api != null) out[walletId] = api
      }

      if (dirty) input.onOutput(out)
    }
  }
})

export const accounts: TamePixie<RootProps> = mapPixie(
  accountPixie,
  (props: RootProps) => props.state.accountIds,
  (props: RootProps, accountId: string): AccountProps => ({
    ...props,
    accountId,
    accountState: props.state.accounts[accountId],
    accountOutput: props.output.accounts[accountId]
  })
)

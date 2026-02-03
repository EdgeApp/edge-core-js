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
import {
  makeWalletCacheSaver,
  WalletCacheSaver
} from '../cache/cache-wallet-saver'
import { syncLogin } from '../login/login'
import { waitForPlugins } from '../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../root-pixie'
import {
  addStorageWallet,
  SYNC_INTERVAL,
  syncStorageWallet
} from '../storage/storage-actions'
import { makeAccountApi } from './account-api'
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

        // Try to load wallet cache for instant UI.
        // Returns the cache setup if successful, undefined otherwise.
        async function tryLoadCache(): Promise<
          import('../cache/cache-wallet-loader').WalletCacheSetup | undefined
        > {
          try {
            const storageWalletId = accountWalletInfos[0]?.id
            if (storageWalletId == null) {
              return undefined
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

            // Create cached wallets with real wallet lookup for delegation:
            const cacheSetup = loadWalletCache(cacheJson, currencyInfos, {
              // Provide a callback to look up real wallets when available
              getRealWallet: (walletId: string) => {
                const accountOutput = ai.props.output.accounts[accountId]
                const pixieWallets = accountOutput?.currencyWallets
                return pixieWallets?.[walletId]
              }
            })
            log.warn(
              `Login: loaded ${cacheSetup.activeWalletIds.length} wallets from cache`
            )

            // Initialize storage wallet FIRST to get real disklets working
            // (storage wallets are just file system access, don't need engines)
            const accountStorageWalletInfo = accountWalletInfos[0]
            if (accountStorageWalletInfo != null) {
              await addStorageWallet(ai, accountStorageWalletInfo)
              log.warn(
                'Login: initialized account storage wallet for cache mode'
              )
            }

            return cacheSetup
          } catch (error: unknown) {
            // Cache doesn't exist or failed to load, continue with normal flow
            // Differentiate between expected (no cache) and unexpected errors
            const err = error as { code?: string; message?: string }
            if (err.code !== 'ENOENT' && err.message !== 'Cannot read file') {
              log.warn(
                'Login: cache loading failed with unexpected error:',
                error
              )
            }
            log.warn('Login: cache not available, using normal flow')
            return undefined
          }
        }

        try {
          await waitForPlugins(ai)
          log.warn('Login: plugins loaded')

          // Try cache-first login for instant UI:
          const cacheSetup = await tryLoadCache()
          if (cacheSetup != null) {
            // Create the API object with cached wallets:
            input.onOutput(makeAccountApi(ai, accountId, { cacheSetup }))
            log.warn('Login: complete (from cache)')
            log.warn(
              `[WalletCache] Cached wallets: ${
                Object.keys(cacheSetup.currencyWallets).length
              }, IDs: ${cacheSetup.activeWalletIds
                .slice(0, 3)
                .map(id => id.slice(0, 8))
                .join(', ')}...`
            )

            // Continue loading files in background to enable real engines.
            // This dispatches ACCOUNT_KEYS_LOADED which sets keysLoaded=true,
            // which populates activeWalletIds and triggers walletPixie to
            // create real currency engines:
            loadBuiltinTokens(ai, accountId)
              .then(async () => {
                // Check if account was logged out during async operation:
                if (ai.props.state.accounts[accountId] == null) {
                  log.warn('Login: background loading cancelled (logged out)')
                  return
                }
                log.warn('Login: loading files in background...')
                // Sync remaining storage wallets (index 1+):
                await Promise.all(
                  accountWalletInfos
                    .slice(1)
                    .map(info => addStorageWallet(ai, info))
                )
                // Check again after async operation:
                if (ai.props.state.accounts[accountId] == null) {
                  log.warn('Login: background loading cancelled (logged out)')
                  return
                }
                await loadAllFiles()
                log.warn('Login: background loading complete, engines starting')
              })
              .catch((error: unknown) => {
                log.error('Login: background loading failed:', error)
              })

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
      let cacheSaver: WalletCacheSaver | undefined
      let cacheTask: PeriodicTask | undefined
      let cacheTaskStarted = false
      const lastWalletStates: { [walletId: string]: unknown } = {}
      let initialSaveDone = false

      function checkForChanges(): void {
        // Read fresh state inside callback to avoid stale closure values:
        const { accountId, state, accountOutput } = input.props
        const accountState = state.accounts[accountId]

        // Guard against logged-out state immediately after reading state:
        if (accountState == null) {
          return
        }

        const accountApi = accountOutput?.accountApi
        if (accountApi == null || cacheSaver == null) {
          return
        }

        // Trigger initial save shortly after initialization to persist any
        // cached wallet data that was loaded on login
        if (!initialSaveDone) {
          initialSaveDone = true
          cacheSaver.markDirty()
          input.props.log.warn('[WalletCache] Triggering initial cache save')
          return
        }

        // Check if any wallet state has changed.
        // Use Redux state directly to avoid stale cached values.
        let hasChanges = false
        for (const walletId of accountState.activeWalletIds) {
          const walletState = state.currency.wallets[walletId]
          if (
            walletState != null &&
            lastWalletStates[walletId] !== walletState
          ) {
            hasChanges = true
            lastWalletStates[walletId] = walletState
          }
        }

        if (hasChanges) {
          cacheSaver.markDirty()
        }
      }

      return {
        update() {
          const ai = toApiInput(input)
          const { accountId, accountOutput, accountState, state } = input.props
          const accountApi = accountOutput?.accountApi

          // Guard: ensure account still exists
          if (state.accounts[accountId] == null) return

          // Initialize cache saver once account API exists
          if (accountApi != null && cacheSaver == null) {
            const storageWalletId = accountState.accountWalletInfos[0]?.id
            if (storageWalletId != null) {
              const cachePath = `accountCache/${storageWalletId}/walletCache.json`

              cacheSaver = makeWalletCacheSaver(
                accountApi,
                ai.props.io.disklet,
                cachePath,
                input.props.log.warn.bind(input.props.log)
              )
              input.props.log.warn('[WalletCache] Cache saver initialized')
            }
          }

          // Start periodic check for changes (only once)
          if (!cacheTaskStarted) {
            cacheTaskStarted = true
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
          cacheTaskStarted = false
          if (cacheSaver != null) {
            cacheSaver.stop()
            cacheSaver = undefined
          }
          // Note: lastWalletStates will be garbage collected with the pixie
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  watcher(input: AccountInput) {
    let lastState: AccountState | undefined
    // let lastWallets

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

  // Outputs real wallets from the currency pixie.
  // The account API's currencyWallets getter merges these with cached wallets.
  currencyWallets(input: AccountInput) {
    let lastActiveWalletIds: string[]

    return () => {
      const { accountOutput, accountState } = input.props
      const { activeWalletIds } = accountState
      const { wallets: currencyWallets } = input.props.output.currency

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

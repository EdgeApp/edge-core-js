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
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgePluginMap,
  EdgeTokenMap
} from '../../types/types'
import { makePeriodicTask } from '../../util/periodic-task'
import { snooze } from '../../util/snooze'
import { loadWalletCache, WalletCacheSetup } from '../cache/cache-wallet-loader'
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

/** Returns the disklet path for the account's wallet cache file. */
function getWalletCachePath(storageWalletId: string): string {
  return `accountCache/${storageWalletId}/walletCache.json`
}

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
    let cacheCleanup: (() => void) | undefined

    return {
      destroy() {
        // Cancel any active cache pollers to prevent unnecessary resource usage
        if (cacheCleanup != null) {
          cacheCleanup()
          cacheCleanup = undefined
        }

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
        // Assumes storage wallets are already initialized.
        async function tryLoadCache(): Promise<WalletCacheSetup | undefined> {
          try {
            const storageWalletId = accountWalletInfos[0]?.id
            if (storageWalletId == null) {
              return undefined
            }

            const cachePath = getWalletCachePath(storageWalletId)
            const cacheJson = await ai.props.io.disklet.getText(cachePath)

            // Build currency info map from loaded plugins:
            const currencyInfos: {
              [pluginId: string]: EdgeCurrencyInfo
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
              },
              // Provide a callback to look up real configs when available
              getRealConfig: (pluginId: string) => {
                const accountOutput = ai.props.output.accounts[accountId]
                const accountApi = accountOutput?.accountApi
                return accountApi?.currencyConfig[pluginId]
              },
              // Pass through the login's pauseWallets option so cached
              // wallets match the initial paused state of real wallets:
              pauseWallets: accountState.pauseWallets
            })

            return cacheSetup
          } catch (error: unknown) {
            // Cache doesn't exist or failed to load, continue with normal flow.
            // Differentiate between expected (no cache) and unexpected errors.
            // Check for "file not found" errors which are expected on first login:
            let isExpectedError = false
            if (error instanceof Error) {
              // Disklet throws Error with 'Cannot read file ...' message.
              // This is coupled to disklet's error format:
              if (error.message.startsWith('Cannot read file')) {
                isExpectedError = true
              }
              // Node.js-style errors have a 'code' property
              const errorWithCode = error as Error & { code?: string }
              if (errorWithCode.code === 'ENOENT') {
                isExpectedError = true
              }
            }
            if (!isExpectedError) {
              log.warn(
                'Login: cache loading failed with unexpected error:',
                error
              )
            }
            return undefined
          }
        }

        try {
          await waitForPlugins(ai)

          // Initialize storage wallets (cheap file reads, needed for both paths):
          await Promise.all(
            accountWalletInfos.map(info => addStorageWallet(ai, info))
          )
          log.warn('Login: synced account repos')

          // Try cache-first login for instant UI:
          const cacheSetup = await tryLoadCache()
          if (cacheSetup != null) {
            // Store cleanup function for use in destroy()
            cacheCleanup = cacheSetup.cleanup

            // Create the API object with cached wallets:
            input.onOutput(makeAccountApi(ai, accountId, { cacheSetup }))

            // Continue loading files in background to enable real engines.
            // This dispatches ACCOUNT_KEYS_LOADED which sets keysLoaded=true,
            // which populates activeWalletIds and triggers walletPixie to
            // create real currency engines:
            loadBuiltinTokens(ai, accountId)
              .then(async () => {
                // Check if account was logged out during async operation:
                if (ai.props.state.accounts[accountId] == null) {
                  return
                }
                await loadAllFiles()
              })
              .catch((error: unknown) => {
                // Check if account was logged out during async operation:
                if (ai.props.state.accounts[accountId] == null) return
                log.error('Login: background loading failed:', error)
                input.props.dispatch({
                  type: 'ACCOUNT_LOAD_FAILED',
                  payload: { accountId, error }
                })
              })

            return await stopUpdates
          }

          // Normal login flow (no cache available):
          await loadBuiltinTokens(ai, accountId)

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
   * Change detection is reactive: the pixie's update() runs whenever Redux
   * state changes, and marks the saver dirty. The saver has a single periodic
   * task that writes to disk at most once every 5 seconds.
   */
  cacheSaver: filterPixie(
    (input: AccountInput) => {
      let cacheSaver: WalletCacheSaver | undefined
      const lastWalletStates: { [walletId: string]: unknown } = {}
      let lastActiveWalletIds: string[] | undefined
      let initialSaveDone = false

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
              const cachePath = getWalletCachePath(storageWalletId)

              cacheSaver = makeWalletCacheSaver(
                accountApi,
                ai.props.io.disklet,
                cachePath,
                input.props.log.warn.bind(input.props.log)
              )
              input.props.log.warn('[WalletCache] Cache saver initialized')
            }
          }

          if (cacheSaver == null) return

          // Trigger initial save to persist cached wallet data from login
          if (!initialSaveDone) {
            initialSaveDone = true
            cacheSaver.markDirty()
            return
          }

          // Reactively check for wallet state changes on each Redux update:
          const accountReduxState = state.accounts[accountId]
          if (accountReduxState == null) return

          let hasChanges = false

          // Check if the active wallet list itself changed (e.g., wallet archived)
          if (lastActiveWalletIds !== accountReduxState.activeWalletIds) {
            hasChanges = true
            lastActiveWalletIds = accountReduxState.activeWalletIds
          }

          for (const walletId of accountReduxState.activeWalletIds) {
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
        },

        destroy() {
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

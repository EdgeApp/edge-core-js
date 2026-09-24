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
import { makePeriodicTask } from '../../util/periodic-task'
import { snooze } from '../../util/snooze'
import {
  bulkLoadWalletCaches,
  loadAccountSeed,
  walletCacheLoaderHooks
} from '../currency/wallet/wallet-cache-loader'
import {
  closeAccountDatabase,
  getAccountDatabase,
  openAccountDatabaseOnce
} from '../db/account-database'
import { fillFiatAmounts } from '../db/rate-fill'
import { syncLogin } from '../login/login'
import { waitForPlugins } from '../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../root-pixie'
import {
  addStorageWallet,
  SYNC_INTERVAL,
  syncStorageWallet
} from '../storage/storage-actions'
import { makeAccountApi } from './account-api'
import { AccountCacheSaver, makeAccountCacheSaver } from './account-cache-saver'
import { loadAllWalletStates, reloadPluginSettings } from './account-files'
import { AccountState, initialCustomTokens } from './account-reducer'
import {
  loadBuiltinTokens,
  loadCustomTokens,
  saveCustomTokens
} from './custom-tokens'

export const EXPEDITED_SYNC_INTERVAL = 5000

/**
 * How often to look for fiat amounts to fill.
 *
 * Not on every write: a hundred transactions arriving together want one pass,
 * and the whole design is that a pass costs a query when there is nothing to
 * do.
 */
export const FIAT_FILL_INTERVAL = 30000

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
        const { accountId, accountState, log } = input.props
        const { accountWalletInfo, accountWalletInfos } = accountState

        async function loadAllFiles(): Promise<void> {
          await Promise.all([
            loadAllWalletStates(ai, accountId),
            loadCustomTokens(ai, accountId),
            reloadPluginSettings(ai, accountId)
          ])
        }

        async function loadEverything(isRetry: boolean): Promise<void> {
          await loadBuiltinTokens(ai, accountId)
          log.warn('Login: currency plugins exist')

          // Start the repo. A retry must not re-attach repos a prior
          // attempt already attached: STORAGE_WALLET_ADDED replaces
          // the whole entry (wiping lastChanges) and starts another
          // sync that can race the one still in flight:
          const missingInfos = isRetry
            ? accountWalletInfos.filter(
                info => ai.props.state.storageWallets[info.id] == null
              )
            : accountWalletInfos
          await Promise.all(
            missingInfos.map(info => addStorageWallet(ai, info))
          )
          log.warn('Login: synced account repos')

          await loadAllFiles()
          log.warn('Login: loaded files')
        }

        let emitted = false
        try {
          // Wait for the currency plugins (should already be loaded by now):
          await waitForPlugins(ai)

          // Open the account database. There is no boot without it, since
          // it is the only place transactions go. A rejection lands in the
          // catch below as a failed login, and `null` means the account
          // logged out while it was opening:
          const database = await openAccountDatabaseOnce(
            ai,
            accountWalletInfo,
            accountId
          )
          if (database == null) return await stopUpdates
          if (database.reindexed.length > 0) {
            log.warn(`Login: reindexed ${database.reindexed.join(', ')}`)
          }

          // Try the account boot cache. On a hit, seed Redux and emit
          // the API object right away, so wallets can start from their
          // own rows without waiting for the repo sync or file loads.
          // The loads below then overwrite the seeded state
          // authoritatively. On a miss (first login, corruption) or an
          // account with legacy Airbitz wallets (their infos cannot be
          // cached), this is today's boot, unchanged:
          const accountSeed = await loadAccountSeed(ai, database.driver)
          if (accountSeed != null) {
            input.props.dispatch({
              type: 'ACCOUNT_CACHE_LOADED',
              payload: {
                accountId,
                configOtherMethodNames: accountSeed.configOtherMethodNames,
                customTokens: accountSeed.customTokens,
                walletStates: accountSeed.walletStates
              }
            })
            input.onOutput(makeAccountApi(ai, accountId))
            emitted = true
            log.warn('Login: emitted account from cache')
            if (walletCacheLoaderHooks.onAccountSeed != null) {
              walletCacheLoaderHooks.onAccountSeed(accountId)
            }

            // Seed every wallet in one dispatch:
            await bulkLoadWalletCaches(ai, accountId, database.driver)

            // The GUI already has the account, so retry transient
            // failures instead of leaving the session half-loaded
            // (a stuck `*Loaded` flag would disable the cache saver):
            for (let attempt = 1; ; ++attempt) {
              // The user may have logged out while we were seeding:
              if (ai.props.state.accounts[accountId] == null) {
                return await stopUpdates
              }
              try {
                await loadEverything(attempt > 1)
                break
              } catch (error: unknown) {
                if (ai.props.state.accounts[accountId] == null) {
                  return await stopUpdates
                }
                log.error(
                  `Login: deferred account load failed (attempt ${attempt}): ${String(
                    error
                  )}`
                )
                if (attempt >= 3) {
                  // Record the terminal failure, so the repo waiters
                  // (changeWalletStates, dataStore, sync, settings)
                  // reject instead of pending forever:
                  input.props.onError(error)
                  input.props.dispatch({
                    type: 'ACCOUNT_LOAD_FAILED',
                    payload: { accountId, error }
                  })
                  return await stopUpdates
                }
                await snooze(5000)
              }
            }
            log.warn('Login: complete')
            return await stopUpdates
          }

          await loadEverything(false)

          // Create the API object:
          input.onOutput(makeAccountApi(ai, accountId))
          log.warn('Login: complete')
        } catch (error: unknown) {
          // The account may have logged out while we were loading:
          if (ai.props.state.accounts[accountId] == null) {
            return await stopUpdates
          }
          if (emitted) {
            // The GUI already has the account, so surface the failure
            // instead of wedging the login:
            log.error(`Login: cache-seeded boot failed: ${String(error)}`)
            input.props.onError(error)
          }
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
      const { accountId, accountState, state } = input.props

      const { accountWalletInfo, customTokens } = accountState
      if (customTokens !== lastTokens && lastTokens !== initialCustomTokens) {
        // The synced repo may not exist yet (cache-seeded boot);
        // return without adopting `customTokens`, so this same diff
        // triggers the write once `addStorageWallet` finishes:
        if (state.storageWallets[accountWalletInfo.id] == null) return

        // Never write before the authoritative load lands: the write
        // rebuilds the whole file from Redux, so a cache-seeded map
        // would wipe tokens another device added. Return without
        // adopting, so the load's merge triggers the write:
        if (!accountState.customTokensLoaded) return

        try {
          await saveCustomTokens(toApiInput(input), accountId)
          // Any dirty edits are on disk now, so a racing load no
          // longer needs to preserve them:
          input.props.dispatch({
            type: 'ACCOUNT_CUSTOM_TOKENS_SAVED',
            payload: { accountId }
          })
        } catch (error: unknown) {
          input.props.onError(error)
        }
        await snooze(100) // Rate limiting
      }
      lastTokens = customTokens
    }
  },

  /**
   * Keeps the account's boot state in the database, so the next login can
   * start its wallets before the account repo loads. See
   * `account-cache-saver.ts`; this is only the wiring.
   */
  cacheSaver(input: AccountInput) {
    let saver: AccountCacheSaver | undefined

    return {
      update() {
        // The account exists only once its database is open, so the saver
        // starts with it:
        if (input.props.accountOutput?.accountApi == null) return
        if (saver == null) {
          const ai = toApiInput(input)
          const { accountId } = input.props
          saver = makeAccountCacheSaver(
            input,
            () => getAccountDatabase(ai, accountId).driver
          )
        }
        saver.update()
      },

      destroy() {
        saver?.destroy()
      }
    }
  },

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

  /**
   * Owns the account's database for the lifetime of the login.
   *
   * The login task opens it and reports a failure; this only makes sure the
   * close happens on logout, whenever the open finishes. A rejected update
   * would tear down the whole pixie tree, so the rejection is logged here
   * and left to the login task to turn into a failed login.
   */
  database(input: AccountInput) {
    return {
      async update() {
        const ai = toApiInput(input)
        const { accountId, accountState, log } = input.props
        try {
          await openAccountDatabaseOnce(
            ai,
            accountState.accountWalletInfo,
            accountId
          )
        } catch (error: unknown) {
          log.error(error)
        }
        return await stopUpdates
      },

      destroy() {
        closeAccountDatabase(toApiInput(input), input.props.accountId)
      }
    }
  },

  /**
   * Keeps the fiat column filling.
   *
   * Runs on a timer rather than on every write, because coverage is the point:
   * a hundred transactions arriving together want one pass, not a hundred.
   * Every pass is a no-op once the cache covers what is stored, so the steady
   * state costs one cheap query.
   *
   * A periodic task runs its first pass the moment it starts, so it starts
   * only once the database is open. An open that fails is the login task's
   * to report, not this one's.
   */
  fiatFill(input: AccountInput) {
    let destroyed = false
    const task = makePeriodicTask(
      async () => {
        if (destroyed) return
        const { accountId, io, state } = input.props
        const database = getAccountDatabase(toApiInput(input), accountId)
        if (database.rateDriver == null) return

        const result = await fillFiatAmounts({
          driver: database.driver,
          rateDriver: database.rateDriver,
          fetch: io.fetch,
          server: state.ratesServer,
          onError: error => input.props.onError(error)
        })
        if (result.changed.length > 0) database.changed(result.changed)
      },
      FIAT_FILL_INTERVAL,
      { onError: error => input.props.onError(error) }
    )

    return {
      async update() {
        const { accountId, accountState } = input.props
        const database = await openAccountDatabaseOnce(
          toApiInput(input),
          accountState.accountWalletInfo,
          accountId
        ).catch(() => null)
        if (database != null && !destroyed) task.start()
        return await stopUpdates
      },
      destroy() {
        destroyed = true
        task.stop()
      }
    }
  },

  currencyWallets(input: AccountInput) {
    let lastActiveWalletIds: string[]

    return () => {
      const { accountOutput, accountState } = input.props
      const { activeWalletIds } = accountState
      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut: { [walletId: string]: EdgeCurrencyWallet } = {}
      if (accountOutput?.currencyWallets != null) {
        lastOut = accountOutput.currencyWallets
      }

      const out: { [walletId: string]: EdgeCurrencyWallet } = {}
      const { wallets } = input.props.output.currency
      for (const walletId of activeWalletIds) {
        const api = wallets[walletId]?.walletApi
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

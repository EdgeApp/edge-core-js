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
  EdgeTokenMap,
  EdgeWalletInfo,
  EdgeWalletStates
} from '../../types/types'
import { makePeriodicTask } from '../../util/periodic-task'
import { snooze } from '../../util/snooze'
import {
  bulkLoadWalletCaches,
  forgetAccountCache,
  rememberAccountCache,
  seedWalletCachesFromAccount,
  walletCacheLoaderHooks
} from '../currency/wallet/wallet-cache-loader'
import { syncLogin } from '../login/login'
import { waitForPlugins } from '../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../root-pixie'
import { makeLocalDisklet } from '../storage/repo'
import {
  addStorageWallet,
  SYNC_INTERVAL,
  syncStorageWallet
} from '../storage/storage-actions'
import { makeAccountApi } from './account-api'
import {
  accountCacheSaverConfig,
  loadAccountCache,
  saveAccountCache
} from './account-cache-file'
import { AccountCacheWallet } from './account-cleaners'
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

/**
 * The account cache saver's write chains, one per account (keyed by
 * the account's local disklet id). Module-level so a write left in
 * flight by a logout is still ahead of the next login's first save:
 * that save reads the newest slot only after the old write has
 * landed, and so never targets the slot the old write is filling.
 */
const cacheWriteChains = new Map<string, Promise<void>>()

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

          // Try the account boot cache. On a hit, seed Redux and emit
          // the API object right away, so wallets can start from their
          // own caches without waiting for the repo sync or file loads.
          // The loads below then overwrite the seeded state
          // authoritatively. On a miss (first login, schema bump,
          // corruption) or an account with legacy Airbitz wallets
          // (their infos cannot be cached), this is today's boot,
          // unchanged:
          const { cache: accountCache } = await loadAccountCache(
            makeLocalDisklet(ai.props.io, accountWalletInfo.id)
          )

          // Keep the parsed file for the session, so a wallet the bulk
          // seed misses looks its entry up here instead of re-reading
          // both slots:
          rememberAccountCache(accountId, accountCache)

          if (accountCache != null && !accountCache.legacyWallets) {
            input.props.dispatch({
              type: 'ACCOUNT_CACHE_LOADED',
              payload: {
                accountId,
                configOtherMethodNames: accountCache.configOtherMethodNames,
                customTokens: accountCache.customTokens,
                walletStates: accountCache.walletStates
              }
            })
            input.onOutput(makeAccountApi(ai, accountId))
            emitted = true
            log.warn('Login: emitted account from cache')
            if (walletCacheLoaderHooks.onAccountSeed != null) {
              walletCacheLoaderHooks.onAccountSeed(accountId)
            }

            // Seed every wallet's cache in one dispatch. The current
            // schema carries them all in the file just read, so the
            // warm path touches no further disk. A file written by an
            // older version has none, so those wallets come from
            // their own files this once, and the saver then folds
            // them into the consolidated file:
            const cachedWallets = Object.keys(accountCache.wallets)
            if (cachedWallets.length > 0) {
              seedWalletCachesFromAccount(ai, accountId, accountCache.wallets)
            } else {
              await bulkLoadWalletCaches(ai, accountId)
            }

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
   * Watches the account's cache-relevant Redux state and persists it
   * to `accountCache.json`, so the next login can start its wallets
   * before the account repo loads. Writes are throttled (trailing
   * edge), never happen after logout, and stop after 3 consecutive
   * failures to avoid log spam. The dirty set deliberately includes
   * account-level `customTokens`: a saver that misses those wipes
   * custom tokens on the next warm login.
   */
  cacheSaver(input: AccountInput) {
    interface CacheSnapshot {
      currencyWalletIds: string[]
      customTokens: EdgePluginMap<EdgeTokenMap>
      legacyWalletInfos: EdgeWalletInfo[]
      walletStates: EdgeWalletStates

      /**
       * Reference identities of every active wallet's cache-relevant
       * state. The Redux slices are immutable, so an unchanged
       * reference means unchanged content, and this stays a cheap
       * reference scan rather than a deep compare of the whole table.
       */
      walletStamp: unknown[]
    }

    function sameStamp(a: unknown[], b: unknown[]): boolean {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) return false
      }
      return true
    }

    let destroyed = false
    let failures = 0
    let lastSaved: CacheSnapshot | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    // Which of the two slots the next write lands in, resolved from
    // disk on the first save. `undefined` means "not looked up yet":
    let nextSlot: number | undefined

    // Every write goes through one chain per account (keyed below by
    // the account's local disklet id, in `cacheWriteChains`). `doSave`
    // is async, so a throttle firing while a previous write is still
    // in flight would otherwise let two saves read the same `nextSlot`
    // and both write it, leaving the other slot two generations stale
    // (and, on a platform whose writes are not atomic, interleaving in
    // one file). The chain outlives this saver on purpose: a logout
    // during a write cannot cancel the write, so the next login's
    // saver waits behind it before resolving its own starting slot.

    // Monotonic across writes, so a reader can tell the two slots
    // apart. Seeded from whichever generation is on disk:
    let sequence = 0

    // The wallet table as last written, so wallets that are not
    // running this session keep their cached state instead of being
    // dropped by a save that only sees the active ones:
    let lastWallets: { [walletId: string]: AccountCacheWallet } = {}

    // The stamp computed by the `update` that armed the pending
    // timer, so `doSave` records exactly what it wrote:
    let pendingStamp: unknown[] = []

    /**
     * Reference identities of the state `collectWallets` reads, in a
     * flat array, so `update` can tell whether anything the cache
     * file actually stores has changed.
     */
    function collectWalletStamp(): unknown[] {
      const { accountState, state } = input.props
      const stamp: unknown[] = []
      for (const walletId of accountState.activeWalletIds) {
        const walletState = state.currency.wallets[walletId]
        if (walletState == null) continue

        // A wallet still loading its files is not written (see
        // `collectWallets`), so its fields must not enter the stamp
        // yet: a toggle made in that window would otherwise be
        // stamped without being written, and a load that merges to
        // the same list would never trigger the write that carries it:
        const { fiatLoaded, nameLoaded, tokenFileEverLoaded } = walletState
        if (!fiatLoaded || !nameLoaded || !tokenFileEverLoaded) {
          stamp.push(null)
          continue
        }
        stamp.push(
          walletState.addresses,
          walletState.balanceMap,
          walletState.enabledTokenIds,
          walletState.fiat,
          walletState.name,
          walletState.otherMethodNames,
          walletState.publicWalletInfo,
          walletState.stakingStatus
        )
      }
      return stamp
    }

    /**
     * Collects every active wallet's cache-relevant Redux state.
     * This is the whole point of the consolidated file: one writer
     * for the entire account, instead of one throttled writer per
     * wallet all racing for the same bridge.
     */
    function collectWallets(): {
      [walletId: string]: AccountCacheWallet
    } {
      const { accountState, state } = input.props

      // Start from what the file already holds, so a wallet that is
      // archived (or simply not running this session) keeps its cached
      // boot state, the way its own file used to just sit on disk.
      // Entries for wallets the account no longer has are dropped, so
      // this cannot grow without bound. The wallet list is the test,
      // not `walletStates`, which only lists wallets with an explicit
      // state and would drop a plain wallet that is merely not loaded:
      const wallets: { [walletId: string]: AccountCacheWallet } = {}
      for (const walletId of Object.keys(lastWallets)) {
        if (accountState.walletInfos[walletId] == null) continue
        if (accountState.walletStates[walletId]?.deleted === true) continue
        wallets[walletId] = lastWallets[walletId]
      }

      for (const walletId of accountState.activeWalletIds) {
        const walletState = state.currency.wallets[walletId]
        if (walletState == null) continue

        // Skip a wallet that has not finished loading its
        // authoritative files, so a cold start never caches
        // placeholder values (the per-wallet saver's old guard). The
        // token-file flag is the sticky one, so a resync, which clears
        // `tokenFileLoaded` but keeps the enabled list, does not
        // freeze this wallet's entry for the rest of the session:
        const {
          fiatLoaded,
          nameLoaded,
          publicWalletInfo,
          tokenFileEverLoaded
        } = walletState
        if (!fiatLoaded || !nameLoaded || !tokenFileEverLoaded) continue
        if (publicWalletInfo == null) continue

        const balances: { [tokenId: string]: string } = {}
        for (const [tokenId, balance] of walletState.balanceMap) {
          balances[tokenId ?? ''] = balance
        }

        wallets[walletId] = {
          walletInfo: publicWalletInfo,
          name: walletState.name,
          fiatCurrencyCode: walletState.fiat,
          enabledTokenIds: walletState.enabledTokenIds,
          balances,
          addresses: walletState.addresses,
          otherMethodNames: walletState.otherMethodNames,
          stakingStatus: walletState.stakingStatus
        }
      }
      return wallets
    }

    async function doSave(): Promise<void> {
      const { accountId, accountState, state } = input.props

      // Never write after logout. The destroy flag is what makes this
      // reliable: redux-pixies serves a destroyed pixie its last props,
      // so the state read below still reports the account as present
      // and would let a write already on the chain through:
      if (destroyed) return
      if (state.accounts[accountId] == null) return

      const snapshot: CacheSnapshot = {
        currencyWalletIds: accountState.currencyWalletIds,
        customTokens: accountState.customTokens,
        legacyWalletInfos: accountState.legacyWalletInfos,
        walletStates: accountState.walletStates,
        walletStamp: pendingStamp
      }

      // Only legacy wallets that actually surface as currency wallets
      // force a cold boot; a legacy repo whose wallet type has no
      // loaded plugin was never visible in the first place:
      const legacyWallets = snapshot.legacyWalletInfos.some(info =>
        snapshot.currencyWalletIds.includes(info.id)
      )

      // Remember each plugin's otherMethods names. The plugin list is
      // static for the whole session, so this needs no dirty tracking:
      const configOtherMethodNames: EdgePluginMap<string[]> = {}
      const { currency } = input.props.state.plugins
      for (const pluginId of Object.keys(currency)) {
        const { otherMethods } = currency[pluginId]
        if (otherMethods == null) continue
        const names = Object.keys(otherMethods).filter(
          name => typeof (otherMethods as any)[name] === 'function'
        )
        if (names.length > 0) configOtherMethodNames[pluginId] = names
      }

      try {
        const disklet = makeLocalDisklet(
          input.props.io,
          accountState.accountWalletInfo.id
        )

        // Resolve the starting slot once. A fresh session must not
        // overwrite the generation it booted from, or a kill during
        // this very first write would leave nothing intact:
        if (nextSlot == null) {
          const existing = await loadAccountCache(disklet)
          nextSlot = existing.nextSlot
          sequence = existing.cache?.sequence ?? 0
          lastWallets = existing.cache?.wallets ?? {}
        }

        const wallets = collectWallets()
        const startMs = Date.now()
        nextSlot = await saveAccountCache(disklet, nextSlot, {
          version: 2,
          sequence: ++sequence,
          customTokens: snapshot.customTokens,
          legacyWallets,
          walletStates: snapshot.walletStates,
          configOtherMethodNames,
          wallets
        })

        // The write is this design's whole cost, and it is invisible
        // from the outside. The saver's throttle bounds this to one
        // line per `throttleMs`, but that runs for the whole session,
        // so it ships at `info` and only a slow write earns `warn`:
        const elapsedMs = Date.now() - startMs
        const line = `Wallet cache: wrote generation ${sequence} with ${
          Object.keys(wallets).length
        } wallets in ${elapsedMs}ms`
        if (elapsedMs > accountCacheSaverConfig.slowWriteMs) {
          input.props.log.warn(line)
        } else {
          input.props.log(line)
        }
        lastWallets = wallets
        failures = 0
        lastSaved = snapshot
      } catch (error: unknown) {
        if (++failures >= 3) {
          input.props.log.error(
            `Account cache saver giving up after ${failures} failures: ${String(
              error
            )}`
          )
        }
      }
    }

    return {
      update() {
        const { accountState } = input.props
        if (accountState == null) return
        if (failures >= 3 || timer != null) return

        // Wait until the authoritative files have loaded,
        // so a cold start never caches placeholder values:
        const { customTokensLoaded, walletStatesLoaded } = accountState
        if (!customTokensLoaded || !walletStatesLoaded) return

        const walletStamp = collectWalletStamp()
        if (
          lastSaved != null &&
          lastSaved.currencyWalletIds === accountState.currencyWalletIds &&
          lastSaved.customTokens === accountState.customTokens &&
          lastSaved.legacyWalletInfos === accountState.legacyWalletInfos &&
          lastSaved.walletStates === accountState.walletStates &&
          sameStamp(lastSaved.walletStamp, walletStamp)
        ) {
          return
        }
        pendingStamp = walletStamp

        timer = setTimeout(() => {
          timer = undefined
          const key = accountState.accountWalletInfo.id
          const chain = (cacheWriteChains.get(key) ?? Promise.resolve()).then(
            doSave,
            doSave
          )
          cacheWriteChains.set(key, chain)
          chain.catch(error => input.props.onError(error))
        }, accountCacheSaverConfig.throttleMs)
      },

      destroy() {
        destroyed = true
        forgetAccountCache(input.props.accountId)
        if (timer != null) clearTimeout(timer)
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

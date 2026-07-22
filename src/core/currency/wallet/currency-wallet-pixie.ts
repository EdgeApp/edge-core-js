import { asMaybe } from 'cleaners'
import { Disklet } from 'disklet'
import {
  combinePixies,
  filterPixie,
  PixieInput,
  stopUpdates,
  TamePixie
} from 'redux-pixies'
import { update } from 'yaob'

import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgeCurrencyEngine,
  EdgeCurrencyTools,
  EdgeCurrencyWallet,
  EdgeTokenMap,
  EdgeWalletInfo,
  JsonObject
} from '../../../types/types'
import { makePeriodicTask, PeriodicTask } from '../../../util/periodic-task'
import { snooze } from '../../../util/snooze'
import { makeTokenInfo } from '../../account/custom-tokens'
import { makeLog } from '../../log/log'
import { getCurrencyTools } from '../../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../../root-pixie'
import { makeLocalDisklet } from '../../storage/repo'
import {
  addStorageWallet,
  SYNC_INTERVAL,
  syncStorageWallet
} from '../../storage/storage-actions'
import {
  getStorageWalletLocalDisklet,
  makeStorageWalletLocalEncryptedDisklet
} from '../../storage/storage-selectors'
import { makeCurrencyWalletApi } from './currency-wallet-api'
import {
  makeCurrencyWalletCallbacks,
  watchCurrencyWallet
} from './currency-wallet-callbacks'
import { asIntegerString, WalletCacheFile } from './currency-wallet-cleaners'
import {
  loadAddressFiles,
  loadFiatFile,
  loadNameFile,
  loadSeenTxCheckpointFile,
  loadTokensFile,
  loadTxFileNames,
  loadWalletSettingsFile,
  writeTokensFile
} from './currency-wallet-files'
import {
  CurrencyWalletState,
  initialTokenIds,
  initialWalletSettings
} from './currency-wallet-reducer'
import { tokenIdsToCurrencyCodes, uniqueStrings } from './enabled-tokens'
import { getEngineScheduler } from './engine-scheduler'
import {
  WALLET_CACHE_FILE,
  walletCacheFile,
  walletCacheSaverConfig
} from './wallet-cache-file'
import {
  loadWalletCacheSeed,
  PUBLIC_KEY_CACHE,
  publicKeyFile,
  walletCacheLoaderHooks
} from './wallet-cache-loader'

export interface CurrencyWalletOutput {
  readonly walletApi: EdgeCurrencyWallet | undefined
  readonly engine: EdgeCurrencyEngine | undefined
  readonly engineStarted: boolean
}

export type CurrencyWalletProps = RootProps & {
  readonly walletId: string
  readonly walletState: CurrencyWalletState
  readonly walletOutput: CurrencyWalletOutput
}

export type CurrencyWalletInput = PixieInput<CurrencyWalletProps>

export const walletPixie: TamePixie<CurrencyWalletProps> = combinePixies({
  // Creates the engine for this wallet:
  engine(input: CurrencyWalletInput) {
    // Set when the wallet is deleted or the user logs out, so startup
    // work still waiting in the scheduler queue knows to give up
    // (`input.props` goes stale at destroy, so it cannot tell us):
    let destroyed = false

    async function update(): Promise<unknown> {
      const { state, walletId, walletState } = input.props
      const { accountId, pluginId, walletInfo } = walletState
      const plugin = state.plugins.currency[pluginId]
      const { currencyCode } = plugin.currencyInfo

      // On a warm account login, one bulk loader reads every wallet's
      // cache files and seeds them in a single dispatch. Hold our own
      // read until then (this update re-runs when the dispatch lands):
      if (state.accounts[accountId]?.bulkWalletSeedPending) {
        return
      }

      let releaseSlot: (() => void) | undefined
      try {
        const ai = toApiInput(input)

        // Load the UI-state cache before the storage-wallet sync,
        // so a previously-seen wallet can emit its API object right away.
        // The bulk loader may have already seeded us; otherwise read our
        // own files (cold logins, wallets activated after login, bulk
        // misses). If either file is missing or invalid (first login,
        // schema bump, corruption), fall through to the cold path:
        let cacheSeeded =
          walletState.publicWalletInfo != null && walletState.nameLoaded
        if (!cacheSeeded) {
          const seed = await loadWalletCacheSeed(ai, walletId)
          if (seed != null) {
            input.props.dispatch({
              type: 'CURRENCY_WALLET_CACHE_LOADED',
              payload: { ...seed, walletId }
            })
            if (walletCacheLoaderHooks.onFallbackSeed != null) {
              walletCacheLoaderHooks.onFallbackSeed(walletId)
            }
            cacheSeeded = true
          }
        }

        if (cacheSeeded) {
          // This wallet is already usable from its cache, so its heavy
          // startup work (repo sync, key derivation, engine creation)
          // waits its turn in a limited-concurrency queue instead of
          // racing every other wallet in the seconds after login.
          // Wallets without a cache skip the queue: they cannot emit at
          // all until this work runs, so they behave exactly as before.
          releaseSlot = await getEngineScheduler(input.props.io).acquire(
            walletId,
            () => {
              input.props.log.warn(
                `${walletId} engine startup exceeded its slot time; freeing the slot for the next wallet`
              )
            }
          )

          // The wallet may have been deleted (or the user logged out)
          // while it waited in line; the finally releases the slot:
          if (destroyed) return
          input.props.log(`${walletId} engine startup slot acquired`)
        }

        // Start the data sync:
        await addStorageWallet(ai, walletInfo)

        // Grab the freshly-synced repos:
        const { state } = input.props
        const walletLocalDisklet = getStorageWalletLocalDisklet(
          state,
          walletInfo.id
        )
        const walletLocalEncryptedDisklet =
          makeStorageWalletLocalEncryptedDisklet(
            state,
            walletInfo.id,
            input.props.io
          )

        // We need to know which transactions exist,
        // since new transactions may come in from the network:
        await loadTxFileNames(input)

        // Derive the public keys. The cache seeding path already read
        // publicKey.json, so reuse that instead of a second disk read:
        const tools = await getCurrencyTools(ai, pluginId)
        const publicWalletInfo = await getPublicWalletInfo(
          walletInfo,
          walletLocalDisklet,
          tools,
          input.props.walletState.publicWalletInfo ?? undefined
        )
        input.props.dispatch({
          type: 'CURRENCY_WALLET_PUBLIC_INFO',
          payload: { walletInfo: publicWalletInfo, walletId }
        })

        // Load the last seen transaction checkpoint into memory.
        // This also loads subscribed addresses from the same file.
        const { checkpoint: seenTxCheckpoint, subscribedAddresses } =
          await loadSeenTxCheckpointFile(input)

        // We need to know which tokens are enabled,
        // so the engine can start in the right state:
        await loadTokensFile(input)

        const { hasWalletSettings = false } = walletState.currencyInfo
        if (hasWalletSettings) {
          await loadWalletSettingsFile(input)
        }

        // Start the engine, reading the account state fresh: the
        // deferred account file loads run in parallel with this block
        // on a warm login, so an earlier snapshot could hand the
        // engine stale settings or tokens:
        const accountState = input.props.state.accounts[accountId]
        const engine = await plugin.makeCurrencyEngine(publicWalletInfo, {
          callbacks: makeCurrencyWalletCallbacks(input),

          // Engine state kept by the core:
          seenTxCheckpoint,
          subscribedAddresses,

          // Wallet-scoped IO objects:
          log: makeLog(
            input.props.logBackend,
            `${pluginId}-${walletInfo.id.slice(0, 2)}`
          ),
          walletLocalDisklet,
          walletLocalEncryptedDisklet,

          // User settings:
          customTokens: accountState.customTokens[pluginId] ?? {},
          enabledTokenIds: input.props.walletState.allEnabledTokenIds,
          userSettings: accountState.userSettings[pluginId] ?? {},
          walletSettings: input.props.walletState.walletSettings
        })
        input.onOutput(engine)

        // Remember the engine's otherMethods names, so the cache can
        // expose pre-engine delegating stubs on the next login:
        const otherMethodNames: string[] = []
        for (const source of [
          engine.otherMethods,
          engine.otherMethodsWithKeys
        ]) {
          if (source == null) continue
          for (const name of Object.keys(source)) {
            if (typeof source[name] !== 'function') continue
            if (!otherMethodNames.includes(name)) otherMethodNames.push(name)
          }
        }
        input.props.dispatch({
          type: 'CURRENCY_WALLET_OTHER_METHOD_NAMES_CHANGED',
          payload: { names: otherMethodNames, walletId }
        })

        // Grab initial state:
        const parentCurrency = { currencyCode, tokenId: null }
        const balance = asMaybe(asIntegerString)(
          engine.getBalance(parentCurrency)
        )
        if (balance != null) {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
            payload: { balance, tokenId: null, walletId }
          })
        }
        const height = engine.getBlockHeight()
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
          payload: { height, walletId }
        })
        if (engine.getStakingStatus != null) {
          await engine.getStakingStatus().then(
            stakingStatus => {
              input.props.dispatch({
                type: 'CURRENCY_ENGINE_CHANGED_STAKING',
                payload: { stakingStatus, walletId }
              })
            },
            error => input.props.onError(error)
          )
        }

        // Load remaining data from disk:
        await loadFiatFile(input)
        await loadNameFile(input)
        await loadAddressFiles(input)
      } catch (error: unknown) {
        input.props.onError(error)
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_FAILED',
          payload: { error, walletId }
        })
      } finally {
        if (releaseSlot != null) releaseSlot()
      }

      // Fire callbacks when our state changes:
      watchCurrencyWallet(input)

      return await stopUpdates
    }

    return {
      update,
      destroy() {
        destroyed = true
      }
    }
  },

  // Creates the API object:
  walletApi: (input: CurrencyWalletInput) => async () => {
    const { walletState } = input.props
    const { nameLoaded, publicWalletInfo } = walletState
    if (publicWalletInfo == null || !nameLoaded) return

    const currencyWalletApi = makeCurrencyWalletApi(input, publicWalletInfo)
    input.onOutput(currencyWalletApi)

    return await stopUpdates
  },

  // Starts & stops the engine for this wallet:
  engineStarted: filterPixie(
    (input: CurrencyWalletInput) => {
      let startupPromise: Promise<unknown> | undefined

      return {
        update() {
          const { log, walletId, walletOutput, walletState } = input.props
          if (walletOutput == null) return
          const { engine, walletApi } = walletOutput
          if (
            walletApi == null ||
            !walletState.fiatLoaded ||
            walletState.engineStarted
          ) {
            return
          }

          if (engine != null && startupPromise == null) {
            log(`${walletId} startEngine`)
            input.props.dispatch({
              type: 'CURRENCY_ENGINE_STARTED',
              payload: { walletId }
            })

            // Turn synchronous errors into promise rejections:
            startupPromise = Promise.resolve()
              .then(() => engine.startEngine())
              .then(() => {
                // Signal that engine startup is complete:
                input.onOutput(true)
              })
              .catch(error => input.props.onError(error))
          }
        },

        destroy() {
          const { log, walletId, walletOutput } = input.props
          if (walletOutput == null) return
          const { engine } = walletOutput

          if (engine != null && startupPromise != null) {
            log(`${walletId} killEngine`)

            // Wait for `startEngine` to finish if that is still going:
            startupPromise
              .then(() => engine.killEngine())
              .catch(error => input.props.onError(error))
              .then(() => {
                input.onOutput(false)
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_STOPPED',
                  payload: { walletId }
                })
              })
              .catch(() => {})
          }
        }
      }
    },
    props =>
      props.state.paused || props.walletState.paused ? undefined : props
  ),

  syncNetworkUpdate: filterPixie(
    (_input: CurrencyWalletInput) => {
      return {
        async update(props) {
          if (props.walletOutput == null) return
          const { engine, engineStarted } = props.walletOutput
          if (engine?.syncNetwork == null || !engineStarted) {
            return
          }
          const { walletState } = props
          const { currencyInfo, walletInfo, publicWalletInfo } = walletState
          // Get the private keys if required by the engine:
          const requiresPrivateKeys =
            currencyInfo.unsafeSyncNetwork === true && publicWalletInfo != null
          const privateKeys = requiresPrivateKeys ? walletInfo.keys : undefined
          // Sync the network for each subscription:
          for (const subscription of walletState.changeServiceSubscriptions) {
            await engine.syncNetwork({
              privateKeys,
              subscribeParam: {
                address: subscription.address,
                checkpoint: subscription.checkpoint,
                needsSync: subscription.status === 'syncing'
              }
            })
          }
          // Update subscription status if managed by the change service:
          props.dispatch({
            type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS',
            payload: {
              subscriptions: walletState.changeServiceSubscriptions.map(
                subscription => ({ ...subscription, status: 'listening' })
              ),
              walletId: props.walletId
            }
          })
        },
        destroy() {}
      }
    },
    props =>
      !props.state.paused &&
      !props.walletState.paused &&
      props.walletState.engineStarted &&
      props.walletState.changeServiceSubscriptions.some(
        subscription =>
          subscription.status === 'syncing' || subscription.status === 'synced'
      )
        ? props
        : undefined
  ),
  syncNetworkTask: filterPixie(
    (input: CurrencyWalletInput) => {
      const syncNetworkTask: PeriodicTask = makePeriodicTask(
        async (): Promise<void> => {
          if (input.props.walletOutput == null) return
          const { engine, engineStarted } = input.props.walletOutput
          if (engine?.syncNetwork == null || !engineStarted) {
            syncNetworkTask.stop()
            return
          }
          const { walletState } = input.props
          const { currencyInfo, walletInfo, publicWalletInfo } = walletState
          // Get the private keys if required by the engine:
          const requiresPrivateKeys =
            currencyInfo.unsafeSyncNetwork === true && publicWalletInfo != null
          const privateKeys = requiresPrivateKeys ? walletInfo.keys : undefined
          const delay = await engine.syncNetwork({
            privateKeys
          })
          syncNetworkTask.setDelay(delay)
        },
        10000,
        {
          onError: error => {
            input.props.log.error(error)
          }
        }
      )

      return {
        update(props) {
          if (props.walletOutput == null) return
          const { engine, engineStarted } = props.walletOutput
          if (
            engine?.syncNetwork != null &&
            engineStarted &&
            !syncNetworkTask?.started
          ) {
            // Setup syncNetwork routine if defined by the currency engine:
            syncNetworkTask.start({ wait: false })
          }
        },
        destroy() {
          // Stop the syncNetwork routine if it was setup:
          if (syncNetworkTask != null) {
            syncNetworkTask.stop()
          }
        }
      }
    },
    props =>
      !props.state.paused &&
      !props.walletState.paused &&
      props.walletState.engineStarted &&
      (props.walletState.currencyInfo.usesChangeServer !== true ||
        props.walletState.changeServiceSubscriptions.some(
          subscription =>
            subscription.status === 'avoiding' ||
            subscription.status === 'reconnecting' ||
            subscription.status === 'resubscribing' ||
            subscription.status === 'subscribingSlowly'
        ))
        ? props
        : undefined
  ),

  syncTimer: filterPixie(
    (input: CurrencyWalletInput) => {
      async function doSync(): Promise<void> {
        const { walletId } = input.props
        await syncStorageWallet(toApiInput(input), walletId)
      }

      // We don't report sync failures, since that could be annoying:
      const task = makePeriodicTask(doSync, SYNC_INTERVAL)

      return {
        update() {
          const { state, walletId, walletOutput } = input.props
          if (walletOutput == null) return

          // Start once the wallet has loaded & finished its initial sync:
          if (
            state.storageWallets[walletId] != null &&
            state.storageWallets[walletId].status.lastSync > 0
          ) {
            task.start({ wait: SYNC_INTERVAL * (1 + Math.random()) })
          }
        },

        destroy() {
          task.stop()
        }
      }
    },
    props =>
      props.state.paused || props.walletState.paused ? undefined : props
  ),

  /**
   * Watches for changes to the token state, and writes those to disk.
   *
   * The pixie system ensures that multiple `update` calls will not occur
   * at once. This way, if the GUI makes dozens of quick token changes,
   * we will consolidate those down to a single write to disk.
   */
  tokenSaver(input: CurrencyWalletInput) {
    let lastEnabledTokenIds: string[] = initialTokenIds

    return async function update() {
      const {
        detectedTokenIds,
        enabledTokenIds,
        tokenFileDirty,
        tokenFileLoaded
      } = input.props.walletState
      if (tokenFileDirty && tokenFileLoaded) {
        const added = whatsNew(enabledTokenIds, lastEnabledTokenIds)
        const removed = whatsNew(lastEnabledTokenIds, enabledTokenIds)
        const shortId = input.props.walletId.slice(0, 2)
        input.props.log.warn(
          `enabledTokenIds: ${shortId} write to disk, add [${added}], remove [${removed}]`
        )

        await writeTokensFile(input, detectedTokenIds, enabledTokenIds).catch(
          error => input.props.onError(error)
        )
        input.props.dispatch({
          type: 'CURRENCY_WALLET_SAVED_TOKEN_FILE',
          payload: { walletId: input.props.walletId }
        })
        await snooze(100) // Rate limiting
      }
      lastEnabledTokenIds = enabledTokenIds
    }
  },

  /**
   * Watches the wallet's cache-relevant Redux state and persists it to
   * `walletCache.json`, so the next login can render this wallet before
   * its engine exists. Writes are throttled to at most one per wallet per
   * `walletCacheSaverConfig.throttleMs` (trailing edge), never happen
   * after logout, and stop after 3 consecutive failures to avoid log spam.
   */
  cacheSaver(input: CurrencyWalletInput) {
    interface CacheSnapshot {
      addresses: EdgeAddress[]
      balanceMap: EdgeBalanceMap
      enabledTokenIds: string[]
      fiat: string
      name: string | null
      otherMethodNames: string[]
    }

    let failures = 0
    let lastSaved: CacheSnapshot | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    async function doSave(): Promise<void> {
      timer = undefined
      const { state, walletId, walletState } = input.props

      // Never write after logout:
      if (state.accounts[walletState.accountId] == null) return

      const snapshot: CacheSnapshot = {
        addresses: walletState.addresses,
        balanceMap: walletState.balanceMap,
        enabledTokenIds: walletState.enabledTokenIds,
        fiat: walletState.fiat,
        name: walletState.name,
        otherMethodNames: walletState.otherMethodNames
      }
      const balances: WalletCacheFile['balances'] = {}
      for (const [tokenId, balance] of snapshot.balanceMap) {
        balances[tokenId ?? ''] = balance
      }

      try {
        await walletCacheFile.save(
          makeLocalDisklet(input.props.io, walletId),
          WALLET_CACHE_FILE,
          {
            version: 2,
            name: snapshot.name,
            fiatCurrencyCode: snapshot.fiat,
            enabledTokenIds: snapshot.enabledTokenIds,
            balances,
            addresses: snapshot.addresses.map(address => ({
              addressType: address.addressType,
              publicAddress: address.publicAddress
            })),
            otherMethodNames: snapshot.otherMethodNames
          }
        )
        failures = 0
        lastSaved = snapshot
      } catch (error: unknown) {
        if (++failures >= 3) {
          input.props.log.error(
            `Wallet cache saver giving up after ${failures} failures: ${String(
              error
            )}`
          )
        }
      }
    }

    return {
      update() {
        const { walletState } = input.props
        if (walletState == null) return
        if (failures >= 3 || timer != null) return

        // Wait until the authoritative files have loaded,
        // so a cold start never caches placeholder values:
        const { fiatLoaded, nameLoaded, tokenFileLoaded } = walletState
        if (!fiatLoaded || !nameLoaded || !tokenFileLoaded) return

        if (
          lastSaved != null &&
          lastSaved.addresses === walletState.addresses &&
          lastSaved.balanceMap === walletState.balanceMap &&
          lastSaved.otherMethodNames === walletState.otherMethodNames &&
          lastSaved.enabledTokenIds === walletState.enabledTokenIds &&
          lastSaved.fiat === walletState.fiat &&
          lastSaved.name === walletState.name
        ) {
          return
        }

        timer = setTimeout(() => {
          doSave().catch(error => input.props.onError(error))
        }, walletCacheSaverConfig.throttleMs)
      },

      destroy() {
        if (timer != null) clearTimeout(timer)
      }
    }
  },

  watcher(input: CurrencyWalletInput) {
    let lastState: CurrencyWalletState | undefined
    let lastUserSettings: object = {}
    let lastWalletSettings: JsonObject = initialWalletSettings
    let lastTokens: EdgeTokenMap = {}
    let lastEnabledTokenIds: string[] = initialTokenIds

    return async () => {
      const { state, walletState, walletOutput } = input.props
      if (walletState == null || walletOutput == null) return
      const { engine, walletApi } = walletOutput
      const { accountId, pluginId } = walletState
      const accountState = state.accounts[accountId]

      // Update API object:
      if (lastState !== walletState && walletApi != null) {
        update(walletApi)
      }
      lastState = walletState

      // On a warm login the engine starts in parallel with the
      // deferred account file loads, so account state can change
      // while `engine` is still null. Never adopt a value we could
      // not deliver, or the engine would miss it forever:
      if (engine == null) return

      // Update engine settings:
      const userSettings =
        accountState.userSettings[pluginId] ?? lastUserSettings
      if (lastUserSettings !== userSettings) {
        await engine.changeUserSettings(userSettings)
      }
      lastUserSettings = userSettings

      // Update the custom tokens:
      const customTokens = accountState.customTokens[pluginId] ?? lastTokens
      if (lastTokens !== customTokens) {
        if (engine.changeCustomTokens != null) {
          await engine.changeCustomTokens(customTokens)
        } else if (engine.addCustomToken != null) {
          for (const tokenId of Object.keys(customTokens)) {
            const token = customTokens[tokenId]
            if (token === lastTokens[tokenId]) continue
            const tokenInfo = makeTokenInfo(token)
            if (tokenInfo == null) continue
            await engine
              .addCustomToken({ ...tokenInfo, ...token })
              .catch(error => input.props.onError(error))
          }
        } // else { no token support }
      }
      lastTokens = customTokens

      // Update wallet-scoped settings:
      const { hasWalletSettings = false } = walletState.currencyInfo
      const { walletSettings } = walletState
      const settingsChanged = lastWalletSettings !== walletSettings

      if (
        settingsChanged &&
        engine.changeWalletSettings != null &&
        hasWalletSettings
      ) {
        await engine.changeWalletSettings(walletSettings).catch(error => {
          input.props.onError(error)
        })
      }
      lastWalletSettings = walletSettings

      // Update enabled tokens:
      const { allEnabledTokenIds } = walletState
      if (lastEnabledTokenIds !== allEnabledTokenIds) {
        if (engine.changeEnabledTokenIds != null) {
          await engine
            .changeEnabledTokenIds(allEnabledTokenIds)
            .catch(error => input.props.onError(error))
        } else if (
          engine.disableTokens != null &&
          engine.enableTokens != null
        ) {
          const removed = tokenIdsToCurrencyCodes(
            accountState.builtinTokens[pluginId],
            accountState.customTokens[pluginId],
            walletState.currencyInfo,
            uniqueStrings(lastEnabledTokenIds, allEnabledTokenIds)
          )
          const added = tokenIdsToCurrencyCodes(
            accountState.builtinTokens[pluginId],
            accountState.customTokens[pluginId],
            walletState.currencyInfo,
            uniqueStrings(allEnabledTokenIds, lastEnabledTokenIds)
          )
          await engine
            .disableTokens(removed)
            .catch(error => input.props.onError(error))
          await engine
            .enableTokens(added)
            .catch(error => input.props.onError(error))
        } // else { no token support }
      }
      lastEnabledTokenIds = allEnabledTokenIds
    }
  }
})

/**
 * Attempts to load/derive the wallet public keys.
 * Pass `cachedWalletInfo` when `publicKey.json` was already read
 * (the cache seeding path), so it is not read a second time.
 */
export async function getPublicWalletInfo(
  walletInfo: EdgeWalletInfo,
  disklet: Disklet,
  tools: EdgeCurrencyTools,
  cachedWalletInfo?: EdgeWalletInfo
): Promise<EdgeWalletInfo> {
  // Try to load the cache:
  const cached =
    cachedWalletInfo ??
    (await publicKeyFile.load(disklet, PUBLIC_KEY_CACHE))?.walletInfo
  if (cached != null) {
    // Return it if it needs not to be upgraded (re-derived):
    if (
      tools.checkPublicKey == null ||
      (await tools.checkPublicKey(cached.keys))
    ) {
      return cached
    }
  }

  // Derive the public keys:
  let publicKeys = {}
  try {
    publicKeys = await tools.derivePublicKey(walletInfo)
  } catch (error: unknown) {}
  const publicWalletInfo = {
    id: walletInfo.id,
    type: walletInfo.type,
    keys: publicKeys
  }

  // Save the cache if it's not empty:
  if (Object.keys(publicKeys).length > 0) {
    await publicKeyFile.save(disklet, PUBLIC_KEY_CACHE, {
      walletInfo: publicWalletInfo
    })
  }

  return publicWalletInfo
}

/**
 * Returns items that only exist in `after`, for debugging token diffs.
 */
export function whatsNew(after: string[], before: string[]): string {
  const beforeSet = new Set(before)
  return after.filter(s => !beforeSet.has(s)).join(', ')
}

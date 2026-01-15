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
  EdgeCurrencyEngine,
  EdgeCurrencyTools,
  EdgeCurrencyWallet,
  EdgeTokenMap,
  EdgeWalletInfo
} from '../../../types/types'
import { makeJsonFile } from '../../../util/file-helpers'
import { makePeriodicTask, PeriodicTask } from '../../../util/periodic-task'
import { snooze } from '../../../util/snooze'
import { makeTokenInfo } from '../../account/custom-tokens'
import { makeLog } from '../../log/log'
import { getCurrencyTools } from '../../plugins/plugins-selectors'
import { RootProps, toApiInput } from '../../root-pixie'
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
import { asIntegerString, asPublicKeyFile } from './currency-wallet-cleaners'
import {
  loadAddressFiles,
  loadFiatFile,
  loadNameFile,
  loadSeenTxCheckpointFile,
  loadTokensFile,
  loadTxFileNames,
  writeTokensFile
} from './currency-wallet-files'
import { CurrencyWalletState, initialTokenIds } from './currency-wallet-reducer'
import { tokenIdsToCurrencyCodes, uniqueStrings } from './enabled-tokens'

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

const PUBLIC_KEY_CACHE = 'publicKey.json'
const publicKeyFile = makeJsonFile(asPublicKeyFile)

export const walletPixie: TamePixie<CurrencyWalletProps> = combinePixies({
  // Creates the engine for this wallet:
  engine: (input: CurrencyWalletInput) => async () => {
    const { state, walletId, walletState } = input.props
    const { accountId, pluginId, walletInfo } = walletState
    const plugin = state.plugins.currency[pluginId]
    const { currencyCode } = plugin.currencyInfo

    try {
      // Start the data sync:
      const ai = toApiInput(input)
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

      // Derive the public keys:
      const tools = await getCurrencyTools(ai, pluginId)
      const publicWalletInfo = await getPublicWalletInfo(
        walletInfo,
        walletLocalDisklet,
        tools
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

      // Start the engine:
      const accountState = state.accounts[accountId]
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
        userSettings: accountState.userSettings[pluginId] ?? {}
      })
      input.onOutput(engine)

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
    }

    // Fire callbacks when our state changes:
    watchCurrencyWallet(input)

    return await stopUpdates
  },

  // Creates the API object:
  walletApi: (input: CurrencyWalletInput) => async () => {
    const { walletOutput, walletState } = input.props
    if (walletOutput == null) return
    const { engine } = walletOutput
    const { nameLoaded, pluginId, publicWalletInfo } = walletState
    if (engine == null || publicWalletInfo == null || !nameLoaded) return
    const tools = await getCurrencyTools(toApiInput(input), pluginId)

    const currencyWalletApi = makeCurrencyWalletApi(
      input,
      engine,
      tools,
      publicWalletInfo
    )
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

  watcher(input: CurrencyWalletInput) {
    let lastState: CurrencyWalletState | undefined
    let lastSettings: object = {}
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

      // Update engine settings:
      const userSettings = accountState.userSettings[pluginId] ?? lastSettings
      if (lastSettings !== userSettings && engine != null) {
        await engine.changeUserSettings(userSettings)
      }
      lastSettings = userSettings

      // Update the custom tokens:
      const customTokens = accountState.customTokens[pluginId] ?? lastTokens
      if (lastTokens !== customTokens && engine != null) {
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

      // Update enabled tokens:
      const { allEnabledTokenIds } = walletState
      if (lastEnabledTokenIds !== allEnabledTokenIds && engine != null) {
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
 */
export async function getPublicWalletInfo(
  walletInfo: EdgeWalletInfo,
  disklet: Disklet,
  tools: EdgeCurrencyTools
): Promise<EdgeWalletInfo> {
  // Try to load the cache:
  const publicKeyCache = await publicKeyFile.load(disklet, PUBLIC_KEY_CACHE)
  if (publicKeyCache != null) {
    // Return it if it needs not to be upgraded (re-derived):
    if (
      tools.checkPublicKey == null ||
      (await tools.checkPublicKey(publicKeyCache.walletInfo.keys))
    ) {
      return publicKeyCache.walletInfo
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

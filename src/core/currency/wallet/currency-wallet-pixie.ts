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
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  JsonObject
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
import { changeEnabledTokens, loadAllFiles } from './currency-wallet-files'
import {
  CurrencyWalletState,
  initialEnabledTokens
} from './currency-wallet-reducer'
import { tokenIdsToCurrencyCodes, uniqueStrings } from './enabled-tokens'

export interface CurrencyWalletOutput {
  readonly walletApi: EdgeCurrencyWallet | undefined
  readonly engine: EdgeCurrencyEngine | undefined
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
      const walletLocalEncryptedDisklet = makeStorageWalletLocalEncryptedDisklet(
        state,
        walletInfo.id,
        input.props.io
      )

      // Derive the public keys:
      const tools = await getCurrencyTools(ai, pluginId)
      const publicWalletInfo = await getPublicWalletInfo(
        walletInfo,
        walletLocalDisklet,
        tools
      )
      const privateWalletInfo = await preparePrivateWalletInfo(
        walletInfo,
        publicWalletInfo
      )
      input.props.dispatch({
        type: 'CURRENCY_WALLET_PUBLIC_INFO',
        payload: { walletInfo: publicWalletInfo, walletId }
      })

      // Start the engine:
      const accountState = state.accounts[accountId]
      const engine = await plugin.makeCurrencyEngine(publicWalletInfo, {
        callbacks: makeCurrencyWalletCallbacks(input),

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
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_SEEDS',
        payload: {
          displayPrivateSeed: engine.getDisplayPrivateSeed(
            privateWalletInfo.keys
          ),
          displayPublicSeed: engine.getDisplayPublicSeed(),
          walletId
        }
      })
      input.onOutput(engine)

      // Grab initial state:
      const { currencyCode } = plugin.currencyInfo
      const balance = asMaybe(asIntegerString)(
        engine.getBalance({ currencyCode })
      )
      if (balance != null) {
        input.props.dispatch({
          type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
          payload: { balance, currencyCode, walletId }
        })
      }
      const height = engine.getBlockHeight()
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
        payload: { height, walletId }
      })
      if (engine.getStakingStatus != null) {
        engine
          .getStakingStatus()
          .then(stakingStatus => {
            input.props.dispatch({
              type: 'CURRENCY_ENGINE_CHANGED_STAKING',
              payload: { stakingStatus, walletId }
            })
          })
          .catch(error => input.props.onError(error))
      }
    } catch (raw: unknown) {
      const error = raw instanceof Error ? raw : new Error(String(raw))
      input.props.onError(error)
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_FAILED',
        payload: { error, walletId }
      })
    }

    // Reload our data from disk:
    loadAllFiles(input).catch(error => input.props.onError(error))

    // Fire callbacks when our state changes:
    watchCurrencyWallet(input)

    return stopUpdates
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
      let syncNetworkTask: PeriodicTask

      return {
        update() {
          const { log, walletId, walletOutput, walletState } = input.props
          const { currencyInfo, walletInfo, publicWalletInfo } = walletState
          if (walletOutput == null) return
          const { engine, walletApi } = walletOutput
          if (
            walletApi == null ||
            !walletState.fiatLoaded ||
            !walletState.fileNamesLoaded ||
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
              .catch(error => input.props.onError(error))

            // Setup syncNetwork routine if defined by the currency engine:
            if (engine.syncNetwork != null) {
              // Get the private keys if required by the engine:
              const requiresPrivateKeys =
                currencyInfo.unsafeSyncNetwork === true &&
                publicWalletInfo != null
              const privateKeys = requiresPrivateKeys
                ? walletInfo.keys
                : undefined
              const doNetworkSync = async (): Promise<void> => {
                if (engine.syncNetwork != null) {
                  const delay = await engine.syncNetwork({ privateKeys })
                  syncNetworkTask.setDelay(delay)
                } else {
                  syncNetworkTask.stop()
                }
              }
              syncNetworkTask = makePeriodicTask(doNetworkSync, 10000, {
                onError: err => {
                  log.error(err)
                }
              })
              syncNetworkTask.start({ wait: false })
            }
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
              .then(() =>
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_STOPPED',
                  payload: { walletId }
                })
              )
              .catch(() => {})
          }

          // Stop the syncNetwork routine if it was setup:
          if (syncNetworkTask != null) {
            syncNetworkTask.stop()
          }
        }
      }
    },
    props =>
      props.state.paused || props.walletState.paused ? undefined : props
  ),

  syncTimer: filterPixie(
    (input: CurrencyWalletInput) => {
      async function doSync(): Promise<void> {
        const { walletId } = input.props
        await syncStorageWallet(toApiInput(input), walletId)
      }

      // We don't report sync failures, since that could be annoying:
      const task = makePeriodicTask(doSync, 30 * 1000)

      return {
        update() {
          const { state, walletId, walletOutput } = input.props
          if (walletOutput == null) return

          // Start once the wallet has loaded & finished its initial sync:
          if (
            state.storageWallets[walletId] != null &&
            state.storageWallets[walletId].status.lastSync > 0
          ) {
            task.start({ wait: true })
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
    let lastEnabledTokens: string[] = initialEnabledTokens

    return async function update() {
      const { enabledTokens } = input.props.walletState
      if (enabledTokens !== lastEnabledTokens && enabledTokens != null) {
        await changeEnabledTokens(input, enabledTokens).catch(error =>
          input.props.onError(error)
        )
        await snooze(100) // Rate limiting
      }
      lastEnabledTokens = enabledTokens
    }
  },

  watcher(input: CurrencyWalletInput) {
    let lastState: CurrencyWalletState | undefined
    let lastSettings: JsonObject = {}
    let lastTokens: EdgeTokenMap = {}
    let lastEnabledTokenIds: string[] = initialEnabledTokens

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
async function getPublicWalletInfo(
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
  } catch (error: any) {}
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
 * Gets private wallet info from the merging the full info with the public
 * wallet info.
 */
export async function preparePrivateWalletInfo(
  walletInfo: EdgeWalletInfoFull,
  publicWalletInfo: EdgeWalletInfo
): Promise<EdgeWalletInfo> {
  const privateWalletInfo: EdgeWalletInfo = {
    id: walletInfo.id,
    type: walletInfo.type,
    keys: { ...walletInfo.keys, ...publicWalletInfo.keys }
  }
  return privateWalletInfo
}

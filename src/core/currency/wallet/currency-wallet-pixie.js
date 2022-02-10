// @flow

import { type Disklet } from 'disklet'
import {
  type PixieInput,
  type TamePixie,
  combinePixies,
  filterPixie,
  stopUpdates
} from 'redux-pixies'
import { update } from 'yaob'

import {
  type EdgeCurrencyEngine,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  type EdgeCurrencyWallet,
  type EdgeWalletInfo
} from '../../../types/types.js'
import { makeJsonFile } from '../../../util/file-helpers.js'
import { makePeriodicTask } from '../../../util/periodic-task.js'
import { makeLog } from '../../log/log.js'
import {
  getCurrencyPlugin,
  getCurrencyTools
} from '../../plugins/plugins-selectors.js'
import { type ApiInput, type RootProps } from '../../root-pixie.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../../storage/storage-actions.js'
import {
  getStorageWalletLocalDisklet,
  makeStorageWalletLocalEncryptedDisklet
} from '../../storage/storage-selectors.js'
import { makeCurrencyWalletApi } from './currency-wallet-api.js'
import {
  makeCurrencyWalletCallbacks,
  watchCurrencyWallet
} from './currency-wallet-callbacks.js'
import { asPublicKeyFile } from './currency-wallet-cleaners.js'
import { loadAllFiles } from './currency-wallet-files.js'
import { type CurrencyWalletState } from './currency-wallet-reducer.js'

export type CurrencyWalletOutput = {
  +walletApi: EdgeCurrencyWallet | void,
  +plugin: EdgeCurrencyPlugin | void,
  +engine: EdgeCurrencyEngine | void
}

export type CurrencyWalletProps = RootProps & {
  +walletId: string,
  +walletState: CurrencyWalletState,
  +walletOutput: CurrencyWalletOutput
}

export type CurrencyWalletInput = PixieInput<CurrencyWalletProps>

const PUBLIC_KEY_CACHE = 'publicKey.json'
const publicKeyFile = makeJsonFile(asPublicKeyFile)

export const walletPixie: TamePixie<CurrencyWalletProps> = combinePixies({
  // Looks up the currency plugin for this wallet:
  plugin: (input: CurrencyWalletInput) => () => {
    // There are still race conditions where this can happen:
    if (input.props.walletOutput && input.props.walletOutput.plugin) return

    const walletInfo = input.props.walletState.walletInfo
    const plugin = getCurrencyPlugin(input.props.state, walletInfo.type)
    input.onOutput(plugin)
  },

  // Creates the engine for this wallet:
  engine: (input: CurrencyWalletInput) => async () => {
    if (!input.props.walletOutput) return

    const walletInfo = input.props.walletState.walletInfo
    const plugin = input.props.walletOutput.plugin
    if (!plugin) return

    try {
      // Start the data sync:
      const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
      await addStorageWallet(ai, walletInfo)
      const { walletState, state } = input.props
      const { accountId, pluginId } = walletState
      const userSettings = state.accounts[accountId].userSettings[pluginId]

      const walletLocalDisklet = getStorageWalletLocalDisklet(
        state,
        walletInfo.id
      )
      const walletLocalEncryptedDisklet = makeStorageWalletLocalEncryptedDisklet(
        state,
        walletInfo.id,
        input.props.io
      )

      const tools = await getCurrencyTools(ai, walletInfo.type)
      const publicWalletInfo = await getPublicWalletInfo(
        walletInfo,
        walletLocalDisklet,
        tools
      )
      const mergedWalletInfo = {
        id: walletInfo.id,
        type: walletInfo.type,
        keys: { ...walletInfo.keys, ...publicWalletInfo.keys }
      }
      input.props.dispatch({
        type: 'CURRENCY_WALLET_PUBLIC_INFO',
        payload: {
          walletInfo: publicWalletInfo,
          walletId: input.props.walletId
        }
      })

      // Start the engine:
      const engine = await plugin.makeCurrencyEngine(mergedWalletInfo, {
        callbacks: makeCurrencyWalletCallbacks(input),
        log: makeLog(
          input.props.logBackend,
          `${plugin.currencyInfo.currencyCode}-${walletInfo.id.slice(0, 2)}`
        ),
        walletLocalDisklet,
        walletLocalEncryptedDisklet,
        userSettings
      })
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_SEEDS',
        payload: {
          walletId: walletInfo.id,
          displayPrivateSeed: engine.getDisplayPrivateSeed(),
          displayPublicSeed: engine.getDisplayPublicSeed()
        }
      })
      input.onOutput(engine)

      // Grab initial state:
      const { currencyCode } = plugin.currencyInfo
      const balance = engine.getBalance({ currencyCode })
      const height = engine.getBlockHeight()
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
        payload: { balance, currencyCode, walletId: input.props.walletId }
      })
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
        payload: { height, walletId: input.props.walletId }
      })
      if (engine.getStakingStatus != null) {
        engine.getStakingStatus().then(stakingStatus => {
          input.props.dispatch({
            type: 'CURRENCY_ENGINE_CHANGED_STAKING',
            payload: { stakingStatus, walletId: input.props.walletId }
          })
        })
      }
    } catch (e) {
      input.props.onError(e)
      input.props.dispatch({ type: 'CURRENCY_ENGINE_FAILED', payload: e })
    }

    // Reload our data from disk:
    loadAllFiles(input).catch(e => input.props.onError(e))

    // Fire callbacks when our state changes:
    watchCurrencyWallet(input)

    return stopUpdates
  },

  // Creates the API object:
  walletApi: (input: CurrencyWalletInput) => () => {
    if (
      !input.props.walletOutput ||
      !input.props.walletOutput.plugin ||
      !input.props.walletOutput.engine ||
      !input.props.walletState.publicWalletInfo ||
      !input.props.walletState.nameLoaded
    ) {
      return
    }

    const { plugin, engine } = input.props.walletOutput
    const { publicWalletInfo } = input.props.walletState
    const currencyWalletApi = makeCurrencyWalletApi(
      input,
      plugin,
      engine,
      publicWalletInfo
    )
    input.onOutput(currencyWalletApi)

    return stopUpdates
  },

  // Starts & stops the engine for this wallet:
  engineStarted: filterPixie(
    (input: CurrencyWalletInput) => {
      let startupPromise: Promise<mixed> | void

      return {
        update() {
          const { log, walletId } = input.props
          if (
            !input.props.walletOutput ||
            !input.props.walletOutput.walletApi ||
            !input.props.walletState.fiatLoaded ||
            !input.props.walletState.fileNamesLoaded ||
            input.props.walletState.engineStarted
          ) {
            return
          }

          const { engine } = input.props.walletOutput
          if (engine != null && startupPromise == null) {
            log(`${walletId} startEngine`)
            input.props.dispatch({
              type: 'CURRENCY_ENGINE_STARTED',
              payload: { walletId }
            })

            // Turn synchronous errors into promise rejections:
            startupPromise = Promise.resolve()
              .then(() => engine.startEngine())
              .catch(e => input.props.onError(e))
          }
        },

        destroy() {
          const { log, walletId } = input.props
          if (!input.props.walletOutput) return

          const { engine } = input.props.walletOutput
          if (engine != null && startupPromise != null) {
            log(`${walletId} killEngine`)

            // Wait for `startEngine` to finish if that is still going:
            startupPromise
              .then(() => engine.killEngine())
              .catch(e => input.props.onError(e))
              .then(() =>
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_STOPPED',
                  payload: { walletId }
                })
              )
              .catch(() => {})
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
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const { walletId } = input.props
        await syncStorageWallet(ai, walletId)
      }

      // We don't report sync failures, since that could be annoying:
      const task = makePeriodicTask(doSync, 30 * 1000)

      return {
        update() {
          const { walletId } = input.props
          // Start once the wallet has loaded & finished its initial sync:
          if (
            input.props.walletOutput &&
            input.props.state.storageWallets[walletId] &&
            input.props.state.storageWallets[walletId].status.lastSync
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

  watcher(input: CurrencyWalletInput) {
    let lastState
    let lastSettings

    return () => {
      const { state, walletState, walletOutput } = input.props
      if (walletState == null || walletOutput == null) return

      // Update API object:
      if (lastState !== walletState) {
        lastState = walletState
        if (walletOutput.walletApi != null) update(walletOutput.walletApi)
      }

      // Update engine settings:
      const { accountId, pluginId } = walletState
      const userSettings = state.accounts[accountId].userSettings[pluginId]
      if (lastSettings !== userSettings) {
        lastSettings = userSettings
        const engine = walletOutput.engine
        if (engine != null) engine.changeUserSettings(userSettings || {})
      }
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
  if (publicKeyCache != null) return publicKeyCache.walletInfo

  // Derive the public keys:
  let publicKeys = {}
  try {
    publicKeys = await tools.derivePublicKey(walletInfo)
  } catch (e) {}
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

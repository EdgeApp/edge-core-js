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
import { loadAllFiles } from './currency-wallet-files.js'
import { type CurrencyWalletState } from './currency-wallet-reducer.js'

export type CurrencyWalletOutput = {
  +api: EdgeCurrencyWallet | void,
  +plugin: EdgeCurrencyPlugin | void,
  +engine: EdgeCurrencyEngine | void
}

export type CurrencyWalletProps = RootProps & {
  +id: string,
  +selfState: CurrencyWalletState,
  +selfOutput: CurrencyWalletOutput
}

export type CurrencyWalletInput = PixieInput<CurrencyWalletProps>

const PUBLIC_KEY_CACHE = 'publicKey.json'

export const walletPixie: TamePixie<CurrencyWalletProps> = combinePixies({
  // Looks up the currency plugin for this wallet:
  plugin: (input: CurrencyWalletInput) => () => {
    // There are still race conditions where this can happen:
    if (input.props.selfOutput && input.props.selfOutput.plugin) return

    const walletInfo = input.props.selfState.walletInfo
    const plugin = getCurrencyPlugin(input.props.state, walletInfo.type)
    input.onOutput(plugin)
  },

  // Creates the engine for this wallet:
  engine: (input: CurrencyWalletInput) => async () => {
    if (!input.props.selfOutput) return

    const walletInfo = input.props.selfState.walletInfo
    const plugin = input.props.selfOutput.plugin
    if (!plugin) return

    try {
      // Start the data sync:
      const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
      await addStorageWallet(ai, walletInfo)
      const { selfState, state } = input.props
      const { accountId, pluginId } = selfState
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
        payload: { walletInfo: publicWalletInfo, walletId: input.props.id }
      })

      // Start the engine:
      const engine = await plugin.makeCurrencyEngine(mergedWalletInfo, {
        callbacks: makeCurrencyWalletCallbacks(input),
        log: makeLog(
          input.props.io,
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
        payload: { balance, currencyCode, walletId: input.props.id }
      })
      input.props.dispatch({
        type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
        payload: { height, walletId: input.props.id }
      })
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
  api: (input: CurrencyWalletInput) => () => {
    if (
      !input.props.selfOutput ||
      !input.props.selfOutput.plugin ||
      !input.props.selfOutput.engine ||
      !input.props.selfState.publicWalletInfo ||
      !input.props.selfState.nameLoaded
    ) {
      return
    }

    const { plugin, engine } = input.props.selfOutput
    const { publicWalletInfo } = input.props.selfState
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
          const { id, log } = input.props
          if (
            !input.props.selfOutput ||
            !input.props.selfOutput.api ||
            !input.props.selfState.fiatLoaded ||
            !input.props.selfState.fileNamesLoaded ||
            input.props.selfState.engineStarted
          ) {
            return
          }

          const { engine } = input.props.selfOutput
          if (engine != null && startupPromise == null) {
            log(`${id} startEngine`)
            input.props.dispatch({
              type: 'CURRENCY_ENGINE_STARTED',
              payload: { walletId: id }
            })

            // Turn synchronous errors into promise rejections:
            startupPromise = Promise.resolve()
              .then(() => engine.startEngine())
              .catch(e => input.props.onError(e))
          }
        },

        destroy() {
          const { id, log } = input.props
          if (!input.props.selfOutput) return

          const { engine } = input.props.selfOutput
          if (engine != null && startupPromise != null) {
            log(`${id} killEngine`)

            // Wait for `startEngine` to finish if that is still going:
            startupPromise
              .then(() => engine.killEngine())
              .catch(e => input.props.onError(e))
              .then(() =>
                input.props.dispatch({
                  type: 'CURRENCY_ENGINE_STOPPED',
                  payload: { walletId: id }
                })
              )
          }
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  syncTimer: filterPixie(
    (input: CurrencyWalletInput) => {
      let started: boolean = false
      let stopped: boolean = false
      let timeout: TimeoutID | void

      async function doSync(): Promise<void> {
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const { id } = input.props

        try {
          syncStorageWallet(ai, id)
        } catch (e) {
          // We don't report sync failures, since that could be annoying.
        }
        if (!stopped) timeout = setTimeout(doSync, 30 * 1000)
      }

      return {
        update() {
          const { id } = input.props
          if (
            !started &&
            input.props.selfOutput &&
            input.props.state.storageWallets[id] &&
            input.props.state.storageWallets[id].status.lastSync
          ) {
            started = true
            doSync()
          }
        },

        destroy() {
          stopped = true
          if (timeout != null) clearTimeout(timeout)
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  watcher(input: CurrencyWalletInput) {
    let lastState
    let lastSettings

    return () => {
      const { state, selfState, selfOutput } = input.props
      if (selfState == null || selfOutput == null) return

      // Update API object:
      if (lastState !== selfState) {
        lastState = selfState
        if (selfOutput.api != null) update(selfOutput.api)
      }

      // Update engine settings:
      const { accountId, pluginId } = selfState
      const userSettings = state.accounts[accountId].userSettings[pluginId]
      if (lastSettings !== userSettings) {
        lastSettings = userSettings
        const engine = selfOutput.engine
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
  try {
    const publicKeyCache = await disklet
      .getText(PUBLIC_KEY_CACHE)
      .then(text => JSON.parse(text))
    if (
      publicKeyCache != null &&
      publicKeyCache.walletInfo != null &&
      publicKeyCache.walletInfo.keys != null &&
      publicKeyCache.walletInfo.id === walletInfo.id &&
      publicKeyCache.walletInfo.type === walletInfo.type
    ) {
      return publicKeyCache.walletInfo
    }
  } catch (e) {}

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
    await disklet.setText(
      PUBLIC_KEY_CACHE,
      JSON.stringify({ walletInfo: publicWalletInfo })
    )
  }

  return publicWalletInfo
}

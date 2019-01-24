// @flow

import { downgradeDisklet } from 'disklet'
import {
  type PixieInput,
  type TamePixie,
  combinePixies,
  stopUpdates
} from 'redux-pixies'
import { update } from 'yaob'

import {
  type EdgeCurrencyEngine,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyWallet
} from '../../../types/types.js'
import { getCurrencyPlugin } from '../../plugins/plugins-selectors.js'
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
  forEachListener,
  makeCurrencyWalletCallbacks,
  watchCurrencyWallet
} from './currency-wallet-callbacks.js'
import { loadAllFiles } from './currency-wallet-files.js'
import { type CurrencyWalletState } from './currency-wallet-reducer.js'

export type CurrencyWalletOutput = {
  +api: EdgeCurrencyWallet | void,
  +plugin: EdgeCurrencyPlugin | void,
  +engine: EdgeCurrencyEngine | void,
  +engineStarted: boolean | void,
  +syncTimer: void
}

export type CurrencyWalletProps = RootProps & {
  +id: string,
  +selfState: CurrencyWalletState,
  +selfOutput: CurrencyWalletOutput
}

export type CurrencyWalletInput = PixieInput<CurrencyWalletProps>

export const walletPixie: TamePixie<CurrencyWalletProps> = combinePixies({
  // Looks up the currency plugin for this wallet:
  plugin: (input: CurrencyWalletInput) => () => {
    // There are still race conditions where this can happen:
    if (input.props.selfOutput && input.props.selfOutput.plugin) return

    const walletInfo = input.props.selfState.walletInfo
    const plugin = getCurrencyPlugin(input.props.state, walletInfo.type)
    input.onOutput(plugin)
  },

  // Starts the engine for this wallet:
  engine: (input: CurrencyWalletInput) => async () => {
    if (!input.props.selfOutput) return

    const walletInfo = input.props.selfState.walletInfo
    const plugin = input.props.selfOutput.plugin
    if (!plugin) return

    try {
      // Start the data sync:
      const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
      await addStorageWallet(ai, walletInfo)
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

      const engine = await plugin.makeEngine(walletInfo, {
        walletLocalDisklet,
        walletLocalEncryptedDisklet,
        walletLocalFolder: downgradeDisklet(walletLocalDisklet),
        walletLocalEncryptedFolder: downgradeDisklet(
          walletLocalEncryptedDisklet
        ),
        callbacks: makeCurrencyWalletCallbacks(input)
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

  // Starts & stops the engine for this wallet:
  engineStarted (input: CurrencyWalletInput) {
    return {
      update () {
        if (
          !input.props.selfOutput ||
          !input.props.selfOutput.api ||
          !input.props.selfState.fiatLoaded ||
          !input.props.selfState.fileNamesLoaded
        ) {
          return
        }

        const { engine, engineStarted } = input.props.selfOutput
        if (engine && !engineStarted) {
          input.onOutput(true)
          try {
            engine.startEngine()
          } catch (e) {
            input.props.onError(e)
          }
        }
      },

      destroy () {
        if (!input.props.selfOutput) return

        const { engine, engineStarted } = input.props.selfOutput
        if (engine && engineStarted) engine.killEngine()
      }
    }
  },

  // Creates the API object:
  api: (input: CurrencyWalletInput) => () => {
    if (
      !input.props.selfOutput ||
      !input.props.selfOutput.plugin ||
      !input.props.selfOutput.engine ||
      !input.props.selfState.nameLoaded
    ) {
      return
    }

    const { plugin, engine } = input.props.selfOutput
    const currencyWalletApi = makeCurrencyWalletApi(input, plugin, engine)
    input.onOutput(currencyWalletApi)

    forEachListener(input, ({ onKeyListChanged }) => {
      if (onKeyListChanged) onKeyListChanged()
    })

    return stopUpdates
  },

  syncTimer (input: CurrencyWalletInput) {
    const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
    let timeout: *

    function startTimer () {
      // Bail out if either the wallet or the repo aren't ready:
      const { id, state } = input.props
      if (
        !input.props.selfOutput ||
        !state.storageWallets[id] ||
        !state.storageWallets[id].status.lastSync
      ) {
        return
      }

      timeout = setTimeout(() => {
        syncStorageWallet(ai, id)
          .then(changes => startTimer())
          .catch(e => startTimer())
      }, 30 * 1000)
    }

    return {
      update () {
        // Kick off the initial sync if we don't already have one running:
        if (timeout == null) return startTimer()
      },

      destroy () {
        clearTimeout(timeout)
      }
    }
  },

  watcher (input: CurrencyWalletInput) {
    let lastState

    return () => {
      const { selfState, selfOutput } = input.props
      if (selfState == null || selfOutput == null) return

      if (lastState !== selfState) {
        lastState = selfState
        if (selfOutput.api != null) update(selfOutput.api)
      }
    }
  }
})

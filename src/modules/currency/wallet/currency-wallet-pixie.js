// @flow
import type {
  AbcCurrencyEngine,
  AbcCurrencyPlugin,
  AbcCurrencyWallet
} from 'airbitz-core-types'
import { combinePixies, stopUpdates } from 'redux-pixies'
import type { PixieInput } from 'redux-pixies'
import { addStorageWallet } from '../../actions.js'
import type { RootProps } from '../../root.js'
import {
  getStorageWalletFolder,
  getStorageWalletLocalFolder
} from '../../selectors.js'
import { getCurrencyPlugin } from '../currency-selectors.js'
import { makeCurrencyWalletApi } from './currency-wallet-api.js'
import {
  forEachListener,
  makeCurrencyWalletCallbacks,
  watchCurrencyWallet
} from './currency-wallet-callbacks.js'
import { loadAllFiles } from './currency-wallet-files.js'
import type { CurrencyWalletState } from './currency-wallet-reducer.js'

export interface CurrencyWalletOutput {
  api: AbcCurrencyWallet | void;
  plugin: AbcCurrencyPlugin | void;
  engine: AbcCurrencyEngine | void;
  engineStarted: boolean | void;
}

export interface CurrencyWalletProps extends RootProps {
  id: string;
  selfState: CurrencyWalletState;
  selfOutput: CurrencyWalletOutput;
}

export type CurrencyWalletInput = PixieInput<CurrencyWalletProps>

export default combinePixies({
  // Looks up the currency plugin for this wallet:
  plugin: (input: CurrencyWalletInput) => () => {
    // There are still race conditions where this can happen:
    if (!input.props.output.currency.plugins) return
    if (input.props.selfOutput && input.props.selfOutput.plugin) return

    const walletInfo = input.props.selfState.walletInfo
    const plugin = getCurrencyPlugin(
      input.props.output.currency.plugins,
      walletInfo.type
    )
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
      await input.props.dispatch(addStorageWallet(walletInfo))
      const state = input.props.state

      const engine = await plugin.makeEngine(walletInfo, {
        walletFolder: getStorageWalletFolder(state, walletInfo.id),
        walletLocalFolder: getStorageWalletLocalFolder(state, walletInfo.id),
        callbacks: makeCurrencyWalletCallbacks(input)
      })
      input.onOutput(engine)
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
          !input.props.selfState.fiatLoaded
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

    const currencyWalletApi = makeCurrencyWalletApi(
      input,
      input.props.selfOutput.plugin,
      input.props.selfOutput.engine
    )
    input.onOutput(currencyWalletApi)

    forEachListener(input, ({ onKeyListChanged }) => {
      if (onKeyListChanged) onKeyListChanged()
    })

    return stopUpdates
  }
})

// @flow

import {
  type PixieInput,
  combinePixies,
  mapPixie,
  stopUpdates
} from 'redux-pixies'
import { close, emit, update } from 'yaob'

import { type EdgeAccount, type EdgeCurrencyWallet } from '../../index.js'
import { waitForCurrencyPlugins } from '../currency/currency-selectors.js'
import { type ApiInput, type RootProps } from '../root.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../storage/storage-actions.js'
import { makeAccountApi } from './account-api.js'
import { loadAllWalletStates, reloadPluginSettings } from './account-files.js'
import { type AccountState } from './account-reducer.js'
import { CurrencyTools } from './currency-api.js'

export type AccountOutput = {
  +api: EdgeAccount,
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
}

export type AccountProps = RootProps & {
  +id: string,
  +selfState: AccountState,
  +selfOutput: AccountOutput
}

export type AccountInput = PixieInput<AccountProps>

const accountPixie = combinePixies({
  api (input: AccountInput) {
    let timer
    let onLoggedOut

    return {
      destroy () {
        // The Pixie library stops updating props after destruction,
        // so we are stuck seeing the logged-in state. Fix that:
        const hack: any = input.props
        hack.state = { accounts: {} }

        if (timer != null) clearTimeout(timer)
        if (onLoggedOut) onLoggedOut()
        if (
          input.props.selfOutput != null &&
          input.props.selfOutput.api != null
        ) {
          update(input.props.selfOutput.api)
          close(input.props.selfOutput.api)
          close(input.props.selfOutput.api.dataStore)
          close(input.props.selfOutput.api.exchangeCache)
          close(input.props.selfOutput.api.pluginData)
          const tools = input.props.selfOutput.api.currencyTools
          for (const n of Object.keys(tools)) close(tools[n])
        }
      },

      async update () {
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const accountId = input.props.id
        const { callbacks, accountWalletInfo } = input.props.selfState
        onLoggedOut = callbacks.onLoggedOut

        const loadAllFiles = async () => {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])

          if (callbacks.onDataChanged) {
            callbacks.onDataChanged()
          }
        }

        try {
          // Start the repo:
          await addStorageWallet(ai, accountWalletInfo)
          await loadAllFiles()

          // Create the currency tools:
          const currencyPlugins = await waitForCurrencyPlugins(ai)
          const currencyTools = {}
          for (const plugin of currencyPlugins) {
            const api = new CurrencyTools(ai, accountId, plugin)
            currencyTools[plugin.pluginName] = api
          }

          // Create the API object:
          input.onOutput(makeAccountApi(ai, accountId, currencyTools))

          // Start the sync timer:
          const startTimer = () => {
            timer = setTimeout(async () => {
              try {
                const changes = await syncStorageWallet(
                  ai,
                  accountWalletInfo.id
                )
                if (changes.length) loadAllFiles()
              } finally {
                startTimer()
              }
            }, 30 * 1000)
          }
          startTimer()
        } catch (error) {
          input.props.dispatch({
            type: 'ACCOUNT_LOAD_FAILED',
            payload: { accountId, error }
          })
        }

        return stopUpdates
      }
    }
  },

  watcher (input: AccountInput) {
    let lastState
    let lastWalletInfos
    let lastWallets
    let lastCurrencySettings
    let lastExchangeState

    return () => {
      const { selfState, selfOutput } = input.props
      if (selfState == null || selfOutput == null) return

      // General account state:
      if (lastState !== selfState) {
        lastState = selfState
        if (selfOutput.api != null) update(selfOutput.api)
      }

      // onKeyListChanged callback:
      if (lastWalletInfos !== selfState.walletInfos) {
        lastWalletInfos = selfState.walletInfos
        const { onKeyListChanged } = selfState.callbacks
        if (onKeyListChanged) onKeyListChanged()
      }

      // Wallet list:
      if (lastWallets !== input.props.output.currency.wallets) {
        lastWallets = input.props.output.currency.wallets
        if (selfOutput.api != null) update(selfOutput.api)
      }

      // Wallet settings:
      if (
        selfOutput.api != null &&
        lastCurrencySettings !== input.props.state.currency.settings
      ) {
        lastCurrencySettings = input.props.state.currency.settings
        const tools = input.props.selfOutput.api.currencyTools
        for (const n of Object.keys(tools)) update(tools[n])
      }

      // Exchange:
      if (lastExchangeState !== input.props.state.exchangeCache) {
        lastExchangeState = input.props.state.exchangeCache
        if (selfOutput.api != null) {
          emit(selfOutput.api.exchangeCache, 'update', void 0)
        }
      }
    }
  },

  currencyWallets (input: AccountInput) {
    let lastActiveWalletIds

    return () => {
      const { activeWalletIds } = input.props.selfState
      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut = {}
      if (input.props.selfOutput && input.props.selfOutput.currencyWallets) {
        lastOut = input.props.selfOutput.currencyWallets
      }

      const out = {}
      for (const walletId of activeWalletIds) {
        if (
          input.props.output.currency.wallets[walletId] != null &&
          input.props.output.currency.wallets[walletId].api != null
        ) {
          const api = input.props.output.currency.wallets[walletId].api
          if (api !== lastOut[walletId]) dirty = true
          out[walletId] = api
        }
      }

      if (dirty) input.onOutput(out)
    }
  }
})

export const accounts = mapPixie(
  accountPixie,
  (props: RootProps) => props.state.accountIds,
  (props: RootProps, id: string): AccountProps => ({
    ...props,
    id,
    selfState: props.state.accounts[id],
    selfOutput: props.output.accounts[id]
  })
)

// @flow

import {
  type PixieInput,
  type TamePixie,
  combinePixies,
  filterPixie,
  mapPixie,
  stopUpdates
} from 'redux-pixies'
import { close, emit, update } from 'yaob'

import {
  type EdgeAccount,
  type EdgeCurrencyWallet,
  type EdgePluginMap,
  type EdgeTokenMap,
  asMaybeOtpError
} from '../../types/types.js'
import { makePeriodicTask } from '../../util/periodic-task.js'
import { snooze } from '../../util/snooze.js'
import { syncAccount } from '../login/login.js'
import { waitForPlugins } from '../plugins/plugins-selectors.js'
import { type RootProps, toApiInput } from '../root-pixie.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../storage/storage-actions.js'
import { makeAccountApi } from './account-api.js'
import { loadAllWalletStates, reloadPluginSettings } from './account-files.js'
import { type AccountState, initialCustomTokens } from './account-reducer.js'
import {
  loadBuiltinTokens,
  loadCustomTokens,
  saveCustomTokens
} from './custom-tokens.js'

export type AccountOutput = {
  +accountApi: EdgeAccount,
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
}

export type AccountProps = RootProps & {
  +accountId: string,
  +accountState: AccountState,
  +accountOutput: AccountOutput
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
        close(accountApi.rateCache)
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
        const { accountWalletInfos } = accountState

        async function loadAllFiles(): Promise<void> {
          await Promise.all([
            loadAllWalletStates(ai, accountId),
            loadCustomTokens(ai, accountId),
            reloadPluginSettings(ai, accountId)
          ])
        }

        try {
          // Wait for the currency plugins (should already be loaded by now):
          await waitForPlugins(ai)
          await loadBuiltinTokens(ai, accountId)
          log.warn('Login: currency plugins exist')

          // Start the repo:
          await Promise.all(
            accountWalletInfos.map(info => addStorageWallet(ai, info))
          )
          log.warn('Login: synced account repos')

          await loadAllFiles()
          log.warn('Login: loaded files')

          // Create the API object:
          input.onOutput(makeAccountApi(ai, accountId))
          log.warn('Login: complete')
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
        const changes: string[] = [].concat(...changeLists)
        if (changes.length > 0) {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])
        }
      }

      async function doLoginSync(): Promise<void> {
        const { accountId } = input.props
        await syncAccount(toApiInput(input), accountId)
      }

      // We don't report sync failures, since that could be annoying:
      const dataTask = makePeriodicTask(doDataSync, 30 * 1000)
      const loginTask = makePeriodicTask(doLoginSync, 30 * 1000, {
        onError(error) {
          // Only send OTP errors to the GUI:
          const otpError = asMaybeOtpError(error)
          if (otpError != null) input.props.onError(otpError)
        }
      })

      return {
        update() {
          const { accountOutput } = input.props
          if (accountOutput == null) return
          const { accountApi } = accountOutput
          if (accountApi == null) return

          // Start once the EdgeAccount API exists:
          dataTask.start({ wait: true })
          loginTask.start({ wait: true })
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
      const { accountId, accountState } = input.props

      const { customTokens } = accountState
      if (customTokens !== lastTokens && lastTokens !== initialCustomTokens) {
        await saveCustomTokens(toApiInput(input), accountId).catch(error =>
          input.props.onError(error)
        )
        await snooze(100) // Rate limiting
      }
      lastTokens = customTokens
    }
  },

  watcher(input: AccountInput) {
    let lastState
    // let lastWallets
    let lastExchangeState

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

      // Exchange:
      if (lastExchangeState !== input.props.state.exchangeCache) {
        lastExchangeState = input.props.state.exchangeCache
        if (accountApi != null) {
          emit(accountApi.rateCache, 'update', undefined)
        }
      }
    }
  },

  currencyWallets(input: AccountInput) {
    let lastActiveWalletIds

    return () => {
      const { accountOutput, accountState } = input.props
      const { activeWalletIds } = accountState
      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut: { [walletId: string]: EdgeCurrencyWallet } = {}
      if (accountOutput != null && accountOutput.currencyWallets != null) {
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

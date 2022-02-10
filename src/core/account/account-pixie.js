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
  asMaybeOtpError
} from '../../types/types.js'
import { makePeriodicTask } from '../../util/periodic-task.js'
import { syncAccount } from '../login/login.js'
import { waitForPlugins } from '../plugins/plugins-selectors.js'
import { type ApiInput, type RootProps } from '../root-pixie.js'
import {
  addStorageWallet,
  syncStorageWallet
} from '../storage/storage-actions.js'
import { makeAccountApi } from './account-api.js'
import { loadAllWalletStates, reloadPluginSettings } from './account-files.js'
import { type AccountState } from './account-reducer.js'

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

        if (
          input.props.accountOutput != null &&
          input.props.accountOutput.accountApi != null
        ) {
          update(input.props.accountOutput.accountApi)
          close(input.props.accountOutput.accountApi)
          close(input.props.accountOutput.accountApi.dataStore)
          close(input.props.accountOutput.accountApi.rateCache)
          const currencies = input.props.accountOutput.accountApi.currencyConfig
          for (const n of Object.keys(currencies)) close(currencies[n])
          const swaps = input.props.accountOutput.accountApi.swapConfig
          for (const n of Object.keys(swaps)) close(swaps[n])
        }
      },

      async update() {
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const { accountId } = input.props
        const { log } = input.props
        const { accountWalletInfos } = input.props.accountState

        async function loadAllFiles(): Promise<void> {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])
        }

        try {
          // Wait for the currency plugins (should already be loaded by now):
          await waitForPlugins(ai)
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
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const { accountId } = input.props
        const { accountWalletInfos } = input.props.accountState

        if (input.props.state.accounts[accountId] == null) return
        const changeLists = await Promise.all(
          accountWalletInfos.map(info => syncStorageWallet(ai, info.id))
        )
        const changes: string[] = [].concat(...changeLists)
        if (changes.length) {
          await Promise.all([
            reloadPluginSettings(ai, accountId),
            loadAllWalletStates(ai, accountId)
          ])
        }
      }

      async function doLoginSync(): Promise<void> {
        const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
        const { accountId } = input.props
        await syncAccount(ai, accountId)
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
          // Start once the EdgeAccount API exists:
          if (
            input.props.accountOutput &&
            input.props.accountOutput.accountApi
          ) {
            dataTask.start({ wait: true })
            loginTask.start({ wait: true })
          }
        },

        destroy() {
          dataTask.stop()
          loginTask.stop()
        }
      }
    },
    props => (props.state.paused ? undefined : props)
  ),

  watcher(input: AccountInput) {
    let lastState
    // let lastWallets
    let lastExchangeState

    return () => {
      const { accountState, accountOutput } = input.props
      if (accountState == null || accountOutput == null) return

      // TODO: Remove this once update detection is reliable:
      if (accountOutput.accountApi != null) update(accountOutput.accountApi)

      // General account state:
      if (lastState !== accountState) {
        lastState = accountState
        if (accountOutput.accountApi != null) {
          // TODO: Put this back once we solve the race condition:
          // update(accountOutput.accountApi)
          for (const pluginId of Object.keys(
            accountOutput.accountApi.currencyConfig
          )) {
            update(accountOutput.accountApi.currencyConfig[pluginId])
          }
          for (const pluginId of Object.keys(
            accountOutput.accountApi.swapConfig
          )) {
            update(accountOutput.accountApi.swapConfig[pluginId])
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
        if (accountOutput.accountApi != null) {
          emit(accountOutput.accountApi.rateCache, 'update', undefined)
        }
      }
    }
  },

  currencyWallets(input: AccountInput) {
    let lastActiveWalletIds

    return () => {
      const { activeWalletIds } = input.props.accountState
      let dirty = lastActiveWalletIds !== activeWalletIds
      lastActiveWalletIds = activeWalletIds

      let lastOut = {}
      if (
        input.props.accountOutput &&
        input.props.accountOutput.currencyWallets
      ) {
        lastOut = input.props.accountOutput.currencyWallets
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

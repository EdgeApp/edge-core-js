// @flow

import {
  type EdgeCurrencyPlugin,
  type EdgeCurrencyWallet,
  type EdgePluginMap,
  type EdgeTokenMap
} from '../../types/types.js'
import { type ApiInput, type RootProps } from '../root-pixie.js'

export function getCurrencyMultiplier(
  plugins: EdgePluginMap<EdgeCurrencyPlugin>,
  customTokens: EdgeTokenMap = {},
  currencyCode: string
): string {
  const pluginIds = Object.keys(plugins)
  for (const pluginId of pluginIds) {
    const info = plugins[pluginId].currencyInfo
    for (const denomination of info.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }
  }

  for (const pluginId of pluginIds) {
    const info = plugins[pluginId].currencyInfo
    for (const token of info.metaTokens) {
      for (const denomination of token.denominations) {
        if (denomination.name === currencyCode) {
          return denomination.multiplier
        }
      }
    }
  }

  for (const tokenId of Object.keys(customTokens)) {
    const token = customTokens[tokenId]
    for (const denomination of token.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }
  }

  return '1'
}

export function waitForCurrencyWallet(
  ai: ApiInput,
  walletId: string
): Promise<EdgeCurrencyWallet> {
  const out: Promise<EdgeCurrencyWallet> = ai.waitFor(
    (props: RootProps): EdgeCurrencyWallet | void => {
      // If the wallet id doesn't even exist, bail out:
      if (props.state.currency.wallets[walletId] == null) {
        throw new Error(`Wallet id ${walletId} does not exist in this account`)
      }

      // Return the error if one exists:
      const { engineFailure } = props.state.currency.wallets[walletId]
      if (engineFailure != null) throw engineFailure

      // Return the API if that exists:
      if (props.output.currency.wallets[walletId] != null) {
        return props.output.currency.wallets[walletId].walletApi
      }
    }
  )
  return out
}

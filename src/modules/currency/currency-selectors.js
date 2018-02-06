// @flow

import type {
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin
} from '../../edge-core-index.js'
import type { ApiInput, ApiProps } from '../root.js'

export function getCurrencyInfo (
  infos: Array<EdgeCurrencyInfo>,
  walletType: string
): EdgeCurrencyInfo {
  for (const info of infos) {
    for (const type of info.walletTypes) {
      if (type === walletType) {
        return info
      }
    }
  }

  throw new Error(`Cannot find a currency info for wallet type ${walletType}`)
}

export function getCurrencyMultiplier (
  infos: Array<EdgeCurrencyInfo>,
  currencyCode: string
): string {
  for (const info of infos) {
    for (const denomination of info.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }

    for (const token of info.metaTokens) {
      for (const denomination of token.denominations) {
        if (denomination.name === currencyCode) {
          return denomination.multiplier
        }
      }
    }
  }

  return '1'
}

export function getCurrencyPlugin (
  plugins: Array<EdgeCurrencyPlugin>,
  walletType: string
) {
  for (const plugin of plugins) {
    const { currencyInfo } = plugin
    for (const type of currencyInfo.walletTypes) {
      if (type === walletType) {
        return plugin
      }
    }
  }

  throw new Error(`Cannot find a currency plugin for wallet type ${walletType}`)
}

export function hasCurrencyPlugin (
  infos: Array<EdgeCurrencyInfo>,
  walletType: string
) {
  for (const info of infos) {
    for (const type of info.walletTypes) {
      if (type === walletType) {
        return true
      }
    }
  }
  return false
}

export function waitForCurrencyPlugins (ai: ApiInput) {
  return ai.waitFor(props => props.output.currency.plugins)
}

export function waitForCurrencyWallet (ai: ApiInput, walletId: string) {
  return ai.waitFor((props: ApiProps) => {
    // If the wallet id doesn't even exist, bail out:
    if (!props.state.currency.wallets[walletId]) {
      throw new Error(`Wallet ${walletId} is not a supported type`)
    }

    // Return the error if one exists:
    if (props.state.currency.wallets[walletId].engineFailure) {
      throw props.state.currency.wallets[walletId].engineFailure
    }

    // Return the context if that exists:
    if (props.output.currency.wallets[walletId]) {
      return props.output.currency.wallets[walletId].api
    }
  })
}

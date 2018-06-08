// @flow

import type {
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin,
  EdgeCurrencyWallet,
  EdgeTokenInfo
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
  currencyInfos: Array<EdgeCurrencyInfo>,
  tokenInfos: Array<EdgeTokenInfo>,
  currencyCode: string
): string {
  for (const info of currencyInfos) {
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

  for (const info of tokenInfos) {
    if (info.currencyCode === currencyCode) return info.multiplier
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
  return ai.waitFor(props => {
    if (props.state.currency.pluginsError) {
      throw props.state.currency.pluginsError
    }
    return props.output.currency.plugins
  })
}

export function waitForCurrencyWallet (
  ai: ApiInput,
  walletId: string
): Promise<EdgeCurrencyWallet> {
  const out: any = ai.waitFor((props: ApiProps): EdgeCurrencyWallet | void => {
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
  return out
}

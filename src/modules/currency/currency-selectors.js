// @flow
import type { AbcCurrencyInfo, AbcCurrencyPlugin } from 'airbitz-core-types'
import type { ApiInput, ApiProps } from '../root.js'

export function getCurrencyInfo (
  infos: Array<AbcCurrencyInfo>,
  walletType: string
): AbcCurrencyInfo {
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
  infos: Array<AbcCurrencyInfo>,
  currencyCode: string
) {
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

  return 1
}

export function getCurrencyPlugin (
  plugins: Array<AbcCurrencyPlugin>,
  walletType: string
) {
  for (const plugin of plugins) {
    const currencyInfo = plugin.currencyInfo || plugin.getInfo()
    for (const type of currencyInfo.walletTypes) {
      if (type === walletType) {
        return plugin
      }
    }
  }

  throw new Error(`Cannot find a currency plugin for wallet type ${walletType}`)
}

export function hasCurrencyPlugin (
  infos: Array<AbcCurrencyInfo>,
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
    if (props.state.currency.wallets[walletId].engineFailure) {
      throw props.state.currency.wallets[walletId].engineFailure
    }
    if (props.output.currency.wallets[walletId]) {
      return props.output.currency.wallets[walletId].api
    }
  })
}

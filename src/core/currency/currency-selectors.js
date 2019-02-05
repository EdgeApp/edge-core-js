// @flow

import {
  type EdgeCurrencyInfo,
  type EdgeCurrencyWallet,
  type EdgeTokenInfo
} from '../../types/types.js'
import { type ApiInput, type RootProps } from '../root-pixie.js'

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

export function waitForCurrencyWallet (
  ai: ApiInput,
  walletId: string
): Promise<EdgeCurrencyWallet> {
  const out: any = ai.waitFor(
    (props: RootProps): EdgeCurrencyWallet | void => {
      // If the wallet id doesn't even exist, bail out:
      if (!props.state.currency.wallets[walletId]) {
        throw new Error(`Wallet ${walletId} is not a supported type`)
      }

      // Return the error if one exists:
      if (props.state.currency.wallets[walletId].engineFailure) {
        throw props.state.currency.wallets[walletId].engineFailure
      }

      // Return the API if that exists:
      if (props.output.currency.wallets[walletId]) {
        return props.output.currency.wallets[walletId].api
      }
    }
  )
  return out
}

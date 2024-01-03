import {
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeTokenMap
} from '../../types/types'
import { ApiInput, RootProps } from '../root-pixie'

export function getCurrencyMultiplier(
  currencyInfo: EdgeCurrencyInfo,
  allTokens: EdgeTokenMap,
  currencyCode: string
): string {
  for (const denomination of currencyInfo.denominations) {
    if (denomination.name === currencyCode) {
      return denomination.multiplier
    }
  }

  for (const tokenId of Object.keys(allTokens)) {
    const token = allTokens[tokenId]
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
    (props: RootProps): EdgeCurrencyWallet | undefined => {
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

import {
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeTokenMap,
  JsonObject
} from '../../types/types'
import { ApiInput, RootProps } from '../root-pixie'

/**
 * Pending wallet settings for newly created wallets.
 * Set before applyKit so the pixie can consume them
 * before creating the engine.
 */
const pendingWalletSettings = new Map<string, JsonObject>()

export function setPendingWalletSettings(
  walletId: string,
  walletSettings: JsonObject
): void {
  pendingWalletSettings.set(walletId, walletSettings)
}

export function consumePendingWalletSettings(
  walletId: string
): JsonObject | undefined {
  const settings = pendingWalletSettings.get(walletId)
  if (settings != null) {
    pendingWalletSettings.delete(walletId)
  }
  return settings
}

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

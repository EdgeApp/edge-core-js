import {
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeTokenMap
} from '../../types/types'
import { ApiInput, RootProps } from '../root-pixie'
import { getEngineScheduler } from './wallet/engine-scheduler'

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

/**
 * Throws if a wallet has been deleted mid-wait or its engine has failed,
 * so `waitFor` conditions surface those as rejections instead of hangs.
 */
export function checkCurrencyWallet(props: RootProps, walletId: string): void {
  // If the wallet id doesn't even exist, bail out:
  if (props.state.currency.wallets[walletId] == null) {
    throw new Error(`Wallet id ${walletId} does not exist in this account`)
  }

  // Throw the error if one exists:
  const { engineFailure } = props.state.currency.wallets[walletId]
  if (engineFailure != null) throw engineFailure
}

export function waitForCurrencyWallet(
  ai: ApiInput,
  walletId: string
): Promise<EdgeCurrencyWallet> {
  // Asking for a wallet is the "the user wants this one" signal,
  // so move its engine startup to the front of the queue:
  bumpEngineQueue(ai, walletId)

  const out: Promise<EdgeCurrencyWallet> = ai.waitFor(
    (props: RootProps): EdgeCurrencyWallet | undefined => {
      checkCurrencyWallet(props, walletId)

      // Return the API if that exists:
      if (props.output.currency.wallets[walletId] != null) {
        return props.output.currency.wallets[walletId].walletApi
      }
    }
  )
  return out
}

/**
 * Prioritizes a wallet's engine startup when its startup work is still
 * waiting in the limited-concurrency queue. Harmless otherwise.
 */
export function bumpEngineQueue(ai: ApiInput, walletId: string): void {
  if (getEngineScheduler(ai.props.io).bump(walletId)) {
    ai.props.log(`${walletId} engine startup bumped to front of queue`)
  }
}

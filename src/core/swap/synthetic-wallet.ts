import { bridgifyObject } from 'yaob'

import {
  EdgeAddress,
  EdgeCurrencyConfig,
  EdgeCurrencyWallet,
  EdgeReceiveAddress
} from '../../types/types'

/**
 * A prefix marking a synthetic destination wallet's `id`. A swap-to-address
 * destination has no real payout wallet, so this id does not resolve to one;
 * it only exists because plugins read `toWallet.id` for order metadata.
 */
export const SYNTHETIC_WALLET_ID_PREFIX = 'synthetic://'

/**
 * Build a synthetic, bridgified destination wallet for a swap-to-address
 * request. It is backed by the real `currencyConfig` core already holds, so
 * `currencyInfo` and `currencyConfig.allTokens` are authentic, while
 * `getAddresses` / `getReceiveAddress` return the pasted destination address.
 *
 * It is bridgified here (core-side) so swap-plugin method calls work unchanged
 * and so it survives the yaob wire format when it rides back to the GUI inside
 * `quote.request.toWallet`. A GUI-built fake cannot do this: its function
 * properties fail to cross the bridge (see the Phase 1 verdict).
 */
export function makeSyntheticDestinationWallet(
  currencyConfig: EdgeCurrencyConfig,
  toAddress: string
): EdgeCurrencyWallet {
  const { currencyInfo } = currencyConfig

  const addresses: EdgeAddress[] = [
    { addressType: 'publicAddress', publicAddress: toAddress }
  ]
  const receiveAddress: EdgeReceiveAddress = {
    publicAddress: toAddress,
    metadata: {},
    nativeAmount: '0'
  }

  const wallet = {
    id: `${SYNTHETIC_WALLET_ID_PREFIX}${currencyInfo.pluginId}`,
    type: currencyInfo.walletType,
    currencyConfig,
    currencyInfo,

    async getAddresses(): Promise<EdgeAddress[]> {
      return addresses
    },

    async getReceiveAddress(): Promise<EdgeReceiveAddress> {
      return receiveAddress
    }
  }
  bridgifyObject(wallet)

  // The synthetic destination only implements the `EdgeCurrencyWallet` surface
  // that swap plugins read on `toWallet` (id, type, currencyInfo,
  // currencyConfig, getAddresses, getReceiveAddress). It is never used as a
  // source wallet, so the spend/sign/sync methods are intentionally absent.
  return wallet as unknown as EdgeCurrencyWallet
}

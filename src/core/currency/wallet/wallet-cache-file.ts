import { EdgeBalanceMap, EdgeWalletInfo } from '../../../types/types'
import { makeJsonFile } from '../../../util/file-helpers'
import { asWalletCacheFile } from './currency-wallet-cleaners'

/**
 * Cached wallet UI state, stored on the wallet's local disklet
 * alongside `publicKey.json`. See `asWalletCacheFile` for the schema.
 */
export const WALLET_CACHE_FILE = 'walletCache.json'
export const walletCacheFile = makeJsonFile(asWalletCacheFile)

/**
 * One wallet's cache files, validated and ready to seed Redux:
 * the public keys from `publicKey.json` plus the UI state from
 * `walletCache.json`, with balances upgraded to an `EdgeBalanceMap`.
 */
export interface WalletCacheSeed {
  balanceMap: EdgeBalanceMap
  enabledTokenIds: string[]
  fiatCurrencyCode: string
  name: string | null
  publicWalletInfo: EdgeWalletInfo
}

/**
 * Tuning for the wallet UI-state cache saver.
 * Tests override the throttle to run quickly.
 */
export const walletCacheSaverConfig = {
  throttleMs: 5000
}

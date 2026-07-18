import { makeJsonFile } from '../../../util/file-helpers'
import { asWalletCacheFile } from './currency-wallet-cleaners'

/**
 * Cached wallet UI state, stored on the wallet's local disklet
 * alongside `publicKey.json`. See `asWalletCacheFile` for the schema.
 */
export const WALLET_CACHE_FILE = 'walletCache.json'
export const walletCacheFile = makeJsonFile(asWalletCacheFile)

/**
 * Tuning for the wallet UI-state cache saver.
 * Tests override the throttle to run quickly.
 */
export const walletCacheSaverConfig = {
  throttleMs: 5000
}

import { makeJsonFile } from '../../../util/file-helpers'
import {
  asStoredWalletCacheFile,
  asWalletCacheFile
} from './currency-wallet-cleaners'

/**
 * Cached wallet UI state, stored on the wallet's local disklet
 * alongside `publicKey.json`. See `asWalletCacheFile` for the schema.
 * Reads accept older schema versions by upgrading them in place,
 * so a version bump never costs an existing device its warm boot.
 */
export const WALLET_CACHE_FILE = 'walletCache.json'
export const walletCacheFile = {
  load: makeJsonFile(asStoredWalletCacheFile).load,
  save: makeJsonFile(asWalletCacheFile).save
}

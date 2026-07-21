import { makeJsonFile } from '../../util/file-helpers'
import { asAccountCacheFile } from './account-cleaners'

/**
 * Cached account boot state, stored on the account's local disklet.
 * See `asAccountCacheFile` for the schema.
 */
export const ACCOUNT_CACHE_FILE = 'accountCache.json'
export const accountCacheFile = makeJsonFile(asAccountCacheFile)

/**
 * Tuning for the account boot-state cache saver.
 * Tests override the throttle to run quickly.
 */
export const accountCacheSaverConfig = {
  throttleMs: 5000
}

import { Disklet } from 'disklet'

import { makeJsonFile } from '../../util/file-helpers'
import {
  AccountCacheFile,
  asAccountCacheFile,
  asStoredAccountCacheFile
} from './account-cleaners'

/**
 * Cached account boot state, stored on the account's local disklet.
 * See `asAccountCacheFile` for the schema.
 *
 * The cache lives in two alternating slots. The disklet exposes no
 * rename (neither its JS interface nor its iOS and Android native
 * modules), so the usual write-temp-then-rename trick is unavailable,
 * and Android's backend truncates the target before writing. A kill
 * mid-write can therefore leave one slot torn. Writing generations
 * alternately means the OTHER slot always holds the last complete
 * one, and `loadAccountCache` takes the newest slot that still
 * parses. (iOS writes with `NSDataWritingAtomic` and never tears, so
 * this only earns its keep on Android.)
 */
export const ACCOUNT_CACHE_FILES = ['accountCache.json', 'accountCache.2.json']
export const accountCacheFile = {
  load: makeJsonFile(asStoredAccountCacheFile).load,
  save: makeJsonFile(asAccountCacheFile).save
}

/**
 * Tuning for the account boot-state cache saver.
 * Tests override the throttle to run quickly.
 */
export const accountCacheSaverConfig = {
  throttleMs: 5000
}

/**
 * Reads both slots and returns the newest one that parses, plus the
 * slot the next write should use. Returns `undefined` cache data when
 * neither slot is readable (first login, schema bump, both torn),
 * which sends the caller to its cold path.
 */
export async function loadAccountCache(
  disklet: Disklet
): Promise<{ cache: AccountCacheFile | undefined; nextSlot: number }> {
  const slots = await Promise.all(
    ACCOUNT_CACHE_FILES.map(
      async path => await accountCacheFile.load(disklet, path)
    )
  )

  let best: AccountCacheFile | undefined
  let bestSlot = -1
  for (let slot = 0; slot < slots.length; ++slot) {
    const cache = slots[slot]
    if (cache == null) continue
    if (best == null || cache.sequence > best.sequence) {
      best = cache
      bestSlot = slot
    }
  }

  // Write over the slot we did NOT just read, so a torn write can
  // never damage the generation we are currently relying on:
  return {
    cache: best,
    nextSlot: bestSlot === -1 ? 0 : (bestSlot + 1) % ACCOUNT_CACHE_FILES.length
  }
}

/**
 * Writes the next generation into `slot` and returns the slot the
 * write after this one should use.
 */
export async function saveAccountCache(
  disklet: Disklet,
  slot: number,
  data: AccountCacheFile
): Promise<number> {
  await accountCacheFile.save(disklet, ACCOUNT_CACHE_FILES[slot], data)
  return (slot + 1) % ACCOUNT_CACHE_FILES.length
}

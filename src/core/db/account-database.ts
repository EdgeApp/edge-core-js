import { base64 } from 'rfc4648'

import { EdgeWalletInfo } from '../../types/types'
import { hmacSha256 } from '../../util/crypto/hashes'
import { base58, utf8 } from '../../util/encoding'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { EdgeInternalIo, EdgeSqlDriver } from './db-driver'
import { reindexStale } from './db-index'
import { prepareDatabase } from './db-open'
import {
  EdgeRateCache,
  openRateCache,
  RATE_DATABASE_NAME,
  RATE_SCHEMA
} from './rate-cache'

/**
 * One database file per account, opened on login and closed on logout.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * The file is named from the account's storage wallet id, the same identity
 * the account's local disklet uses, so an account's database sits beside the
 * rest of its device-local state and is removed with it.
 */

/** One transaction, named the only way a reader can look one up. */
export interface EdgeTxRef {
  walletId: string
  txid: string
}

export interface EdgeAccountDatabase {
  driver: EdgeSqlDriver
  /**
   * The device's rate cache, on its own connection.
   *
   * Two handles onto it: this one writes, and the account's own connection
   * has it attached read-only for the materialization join. They are separate
   * because the cache is a separate file, and nothing spans the two
   * transactionally.
   */
  rateDriver?: EdgeSqlDriver
  /** Derived tables rebuilt while opening, for the login log. */
  reindexed: string[]

  /**
   * Reports transactions whose stored form changed.
   *
   * Batched and throttled, and carrying identity only. A rate backfill can
   * touch thousands of rows, and one event per row would swamp the bridge --
   * so a reader is told *which* transactions to re-read, not what they now
   * say.
   */
  changed: (refs: EdgeTxRef[]) => void
  onChanged: (f: (refs: EdgeTxRef[]) => void) => () => void

  close: () => Promise<void>
}

/** How long changes accumulate before a reader hears about them. */
const CHANGE_THROTTLE_MS = 250

/**
 * Collects change reports and delivers them in batches.
 *
 * Deduplicated by identity, because the commonest pattern by far is the same
 * transaction being written twice in a row -- once per asset it touched.
 */
function makeChangeNotifier(): Pick<
  EdgeAccountDatabase,
  'changed' | 'onChanged'
> & { stop: () => void } {
  const listeners = new Set<(refs: EdgeTxRef[]) => void>()
  const pending = new Map<string, EdgeTxRef>()
  let timeout: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    timeout = undefined
    if (pending.size === 0) return
    const refs = [...pending.values()]
    pending.clear()
    for (const listener of listeners) listener(refs)
  }

  return {
    changed(refs) {
      for (const ref of refs) {
        pending.set(`${ref.walletId}\u001f${ref.txid}`, ref)
      }
      if (timeout == null) timeout = setTimeout(flush, CHANGE_THROTTLE_MS)
    },

    onChanged(f) {
      listeners.add(f)
      return () => listeners.delete(f)
    },

    stop() {
      if (timeout != null) clearTimeout(timeout)
      timeout = undefined
      listeners.clear()
      pending.clear()
    }
  }
}

/**
 * Every database currently open, keyed by account id.
 *
 * The core reaches an account's database through the pixie output; this map
 * exists so tests can reach it too, since the `EdgeAccount` they hold is a
 * yaob bridge with no path back to core internals.
 */
export const openAccountDatabases = new Map<string, EdgeAccountDatabase>()

/** The database name for an account, from its storage wallet id. */
export function accountDatabaseName(accountWalletId: string): string {
  return base58.stringify(base64.parse(accountWalletId))
}

/**
 * The encryption key for an account's database.
 *
 * Derived from the same `dataKey` that protects the account's sync repo, so
 * the local cache is no weaker than the encrypted files it caches, and so
 * there is no second secret to store, back up or rotate. Naming the
 * derivation follows `hashStorageWalletFilename`.
 */
export function accountDatabaseKey(
  accountWalletInfo: EdgeWalletInfo
): Uint8Array {
  const { dataKey } = asEdgeStorageKeys(accountWalletInfo.keys)
  return hmacSha256(utf8.parse('txDatabase'), dataKey)
}

/**
 * Opens an account's database.
 *
 * The database holds nothing that cannot be rebuilt, so a file that will not
 * open is deleted and recreated rather than repaired -- which also covers the
 * one case that has no other remedy, a file left behind by a previous
 * installation whose key is gone.
 *
 * A caller that gets `undefined` has a platform with no SQL driver.
 */
export async function openAccountDatabase(
  io: EdgeInternalIo,
  accountWalletInfo: EdgeWalletInfo
): Promise<EdgeAccountDatabase | undefined> {
  const { makeSqlDriver, deleteSqlDatabase } = io
  if (makeSqlDriver == null) return undefined

  const name = accountDatabaseName(accountWalletInfo.id)
  const key = accountDatabaseKey(accountWalletInfo)

  const open = async (): Promise<EdgeAccountDatabase> => {
    const driver = await makeSqlDriver(name, key)
    try {
      // This is also what proves the key was right: the codec only reports a
      // bad key when something reads a page, so an open on its own has not
      // established anything yet.
      await prepareDatabase(driver)
      const reindexed = await reindexStale(driver)
      const notifier = makeChangeNotifier()

      /*
       * The rate cache is shared and optional. An account that cannot open it
       * works exactly as before, minus fiat amounts -- so a failure here is
       * logged by the caller rather than failing a login.
       */
      let rates: EdgeRateCache | undefined
      try {
        rates = await openRateCache(io)
        if (rates != null) await driver.attach(RATE_DATABASE_NAME, RATE_SCHEMA)
      } catch (error) {
        await rates?.close().catch(() => undefined)
        rates = undefined
      }

      return {
        driver,
        rateDriver: rates?.driver,
        reindexed,
        changed: notifier.changed,
        onChanged: notifier.onChanged,
        close: async () => {
          notifier.stop()
          await driver.close()
          await rates?.close().catch(() => undefined)
        }
      }
    } catch (error) {
      // Do not leak the handle when the check is what failed:
      await driver.close().catch(() => undefined)
      throw error
    }
  }

  try {
    return await open()
  } catch (error) {
    if (deleteSqlDatabase == null) throw error
    await deleteSqlDatabase(name)
    return await open()
  }
}

/** Removes an account's database, for account deletion. */
export async function deleteAccountDatabase(
  io: EdgeInternalIo,
  accountWalletId: string
): Promise<void> {
  const { deleteSqlDatabase } = io
  if (deleteSqlDatabase == null) return
  await deleteSqlDatabase(accountDatabaseName(accountWalletId))
}

import { base64 } from 'rfc4648'

import { EdgeWalletInfo } from '../../types/types'
import { hmacSha256 } from '../../util/crypto/hashes'
import { base58, utf8 } from '../../util/encoding'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { EdgeInternalIo, EdgeSqlDriver } from './db-driver'
import { reindexStale } from './db-index'
import { prepareDatabase } from './db-open'

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

export interface EdgeAccountDatabase {
  driver: EdgeSqlDriver
  /** Derived tables rebuilt while opening, for the login log. */
  reindexed: string[]
  close: () => Promise<void>
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
      return { driver, reindexed, close: async () => await driver.close() }
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

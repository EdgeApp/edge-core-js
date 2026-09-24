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
 * Every database currently open, under a key unique to its open.
 *
 * The core reaches an account's database through `getAccountDatabase`; this
 * map exists so tests can reach it too, since the `EdgeAccount` they hold is
 * a yaob bridge with no path back to core internals. Not keyed by account id,
 * because every context numbers its logins from zero.
 */
export const openAccountDatabases = new Map<string, EdgeAccountDatabase>()
let openCount = 0

/** One account's open, from the moment it starts until logout. */
interface OpenEntry {
  promise: Promise<EdgeAccountDatabase | null>

  /**
   * Set before `promise` resolves, so every continuation of that promise
   * finds it here -- which is what lets a synchronous getter answer without
   * caring which awaiter ran first.
   */
  handle: EdgeAccountDatabase | null

  /** Where `openAccountDatabases` lists it. */
  key: string
}

/**
 * The opens in flight or done, per context and then per account.
 *
 * Per context first, because account ids are only unique within one: every
 * context counts its logins from zero, and a test process runs several.
 */
const openEntries = new WeakMap<EdgeInternalIo, Map<string, OpenEntry>>()

/** Anything that carries the context's `io`: an API input, a pixie input. */
interface IoInput {
  readonly props: { readonly io: EdgeInternalIo }
}

function entriesFor(io: EdgeInternalIo): Map<string, OpenEntry> {
  let entries = openEntries.get(io)
  if (entries == null) {
    entries = new Map()
    openEntries.set(io, entries)
  }
  return entries
}

/**
 * Opens an account's database, once per login.
 *
 * Both the login task and the pixie that owns the close await this, and get
 * the same open. It rejects when the database cannot be opened at all --
 * there is no boot without it -- and resolves `null` only when the account
 * logged out while it was opening, in which case the handle it opened has
 * already been closed again, since nothing is left to own it.
 */
export function openAccountDatabaseOnce(
  ai: IoInput,
  accountWalletInfo: EdgeWalletInfo,
  accountId: string
): Promise<EdgeAccountDatabase | null> {
  const { io } = ai.props
  const entries = entriesFor(io)
  const existing = entries.get(accountId)
  if (existing != null) return existing.promise

  const entry: OpenEntry = {
    promise: Promise.resolve(null),
    handle: null,
    key: `${accountId}#${++openCount}`
  }
  entry.promise = openAccountDatabase(io, accountWalletInfo).then(
    async database => {
      if (entries.get(accountId) !== entry) {
        await database.close().catch(() => undefined)
        return null
      }
      entry.handle = database
      openAccountDatabases.set(entry.key, database)
      return database
    }
  )
  entries.set(accountId, entry)
  return entry.promise
}

/**
 * An account's open database.
 *
 * The account is emitted only after its database opens, so nothing that
 * reaches here from an account API can find it missing. Throwing rather than
 * returning `undefined` is what makes a read that somehow gets here early a
 * visible bug instead of a silently empty answer.
 */
export function getAccountDatabase(
  ai: IoInput,
  accountId: string
): EdgeAccountDatabase {
  const handle = entriesFor(ai.props.io).get(accountId)?.handle
  if (handle == null) throw new Error('Account database is not open')
  return handle
}

/**
 * An account's open database, or `undefined` once it has closed.
 *
 * For the one reader that runs during logout itself; everything else uses
 * `getAccountDatabase`, where a missing database is a bug worth throwing on.
 */
export function findAccountDatabase(
  ai: IoInput,
  accountId: string
): EdgeAccountDatabase | undefined {
  return entriesFor(ai.props.io).get(accountId)?.handle ?? undefined
}

/**
 * Ends an account's database, for logout.
 *
 * An open still in flight is not waited for: removing its entry is what tells
 * it, when it finishes, that nothing owns it any more.
 */
export function closeAccountDatabase(ai: IoInput, accountId: string): void {
  const entries = entriesFor(ai.props.io)
  const entry = entries.get(accountId)
  if (entry == null) return
  entries.delete(accountId)
  const { handle } = entry
  if (handle == null) return
  openAccountDatabases.delete(entry.key)
  handle.close().catch(() => undefined)
}

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
 * It rejects on a platform with no SQL driver, and when the file will not
 * open even after being deleted. Either way the error names the account
 * database, because that is what a failed login has to say.
 */
export async function openAccountDatabase(
  io: EdgeInternalIo,
  accountWalletInfo: EdgeWalletInfo
): Promise<EdgeAccountDatabase> {
  const { makeSqlDriver, deleteSqlDatabase } = io
  if (makeSqlDriver == null) {
    throw new Error('Cannot open the account database: no SQL driver')
  }

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
  } catch (firstError) {
    try {
      if (deleteSqlDatabase == null) throw firstError
      await deleteSqlDatabase(name)
      return await open()
    } catch (error) {
      throw new Error(`Cannot open the account database: ${String(error)}`)
    }
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

import { makeJsonFile } from '../../../util/file-helpers'
import { getAccountDatabase } from '../../db/account-database'
import { EdgeSqlDriver } from '../../db/db-driver'
import {
  AccountSeed,
  hasWalletCache,
  readAccountSeed,
  readWalletSeeds,
  WalletCacheSeed
} from '../../db/wallet-store'
import { ApiInput } from '../../root-pixie'
import { asPublicKeyFile } from './currency-wallet-cleaners'

export const PUBLIC_KEY_CACHE = 'publicKey.json'
export const publicKeyFile = makeJsonFile(asPublicKeyFile)

/**
 * Test hooks for observing cache seeding, following the same
 * mutable-config pattern as `accountCacheSaverConfig`.
 */
export const walletCacheLoaderHooks: {
  /** Receives each account id seeded by `ACCOUNT_CACHE_LOADED`. */
  onAccountSeed?: (accountId: string) => void
  /** Receives the seeded wallet ids of each bulk dispatch. */
  onBulkSeed?: (walletIds: string[]) => void
  /** Receives each wallet id seeded by a pixie's fallback read. */
  onFallbackSeed?: (walletId: string) => void
  /** Parks a pixie's fallback read on the seed it already found. */
  fallbackSeedGate?: Promise<void>
  /** Runs ahead of the account-level read; throwing fails that read. */
  beforeAccountSeed?: () => void
  /** Runs ahead of the bulk wallet read; throwing fails that read. */
  beforeWalletSeeds?: () => void
} = {}

/**
 * The account-level boot state, when there is one to boot from.
 *
 * The boot is warm when the database holds a cached wallet and the account
 * has no legacy Airbitz wallets, whose infos cannot be cached. Anything else
 * -- a first login, a device whose saver has not run, a read that fails --
 * is a cold boot, which is today's boot unchanged. The cache is only ever a
 * head start, so a failure here is logged rather than failing the login.
 */
export async function loadAccountSeed(
  ai: ApiInput,
  driver: EdgeSqlDriver
): Promise<AccountSeed | undefined> {
  try {
    if (!(await hasWalletCache(driver))) return
    walletCacheLoaderHooks.beforeAccountSeed?.()
    const seed = await readAccountSeed(driver)
    if (seed.legacyWallets) return
    return seed
  } catch (error: unknown) {
    ai.props.log.warn(
      `Login: wallet cache unreadable, booting cold: ${String(error)}`
    )
  }
}

/**
 * Seeds every active wallet from its rows in a single
 * `CURRENCY_WALLETS_CACHE_LOADED` dispatch, so a warm login costs one store
 * tick for the whole wallet list instead of two dispatches per wallet.
 * Wallets with no cached row are simply absent from the payload; their
 * pixies fall back to their own reads.
 *
 * Always dispatches, even with zero seeds, since the wallet pixies are
 * holding for `bulkWalletSeedPending` to clear.
 */
export async function bulkLoadWalletCaches(
  ai: ApiInput,
  accountId: string,
  driver: EdgeSqlDriver
): Promise<void> {
  let seeds: { [walletId: string]: WalletCacheSeed } = {}
  try {
    const accountState = ai.props.state.accounts[accountId]
    if (accountState == null) return
    walletCacheLoaderHooks.beforeWalletSeeds?.()
    seeds = await readWalletSeeds(driver, accountState.activeWalletIds)
  } catch (error: unknown) {
    // Never skip the dispatch below: an empty seed table just sends each
    // wallet to its own read:
    ai.props.log.warn(`Bulk wallet-cache load failed: ${String(error)}`)
  }

  // The account may have logged out while we read:
  if (ai.props.state.accounts[accountId] == null) return

  ai.props.dispatch({
    type: 'CURRENCY_WALLETS_CACHE_LOADED',
    payload: { accountId, seeds }
  })

  if (walletCacheLoaderHooks.onBulkSeed != null) {
    walletCacheLoaderHooks.onBulkSeed(Object.keys(seeds))
  }
}

/**
 * Reads one wallet's seed for a pixie that the bulk seed missed: a cold
 * login, or a wallet reactivated mid-session. The rows hold every wallet the
 * account has cached, archived ones included.
 */
export async function loadWalletCacheSeed(
  ai: ApiInput,
  walletId: string,
  accountId: string
): Promise<WalletCacheSeed | undefined> {
  let seed: WalletCacheSeed | undefined
  try {
    const { driver } = getAccountDatabase(ai, accountId)
    seed = (await readWalletSeeds(driver, [walletId]))[walletId]
  } catch (error: unknown) {
    // A broken read just means this wallet boots cold:
    ai.props.log.warn(`${walletId} wallet-cache read failed: ${String(error)}`)
  }
  if (walletCacheLoaderHooks.fallbackSeedGate != null) {
    await walletCacheLoaderHooks.fallbackSeedGate
  }
  return seed
}

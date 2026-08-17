import { EdgeBalanceMap } from '../../../types/types'
import { makeJsonFile } from '../../../util/file-helpers'
import { loadAccountCache } from '../../account/account-cache-file'
import { AccountCacheWallet } from '../../account/account-cleaners'
import { ApiInput } from '../../root-pixie'
import { makeLocalDisklet } from '../../storage/repo'
import { asPublicKeyFile, WalletCacheFile } from './currency-wallet-cleaners'
import {
  WALLET_CACHE_FILE,
  walletCacheFile,
  WalletCacheSeed
} from './wallet-cache-file'

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
} = {}

/**
 * Upgrades a validated `walletCache.json` balance table
 * to the `EdgeBalanceMap` shape the Redux slice uses.
 */
export function makeCachedBalanceMap(
  balances: WalletCacheFile['balances']
): EdgeBalanceMap {
  const balanceMap: EdgeBalanceMap = new Map()
  for (const tokenId of Object.keys(balances)) {
    balanceMap.set(tokenId === '' ? null : tokenId, balances[tokenId])
  }
  return balanceMap
}

/**
 * Converts one wallet's entry in the account cache file into a seed.
 */
export function toWalletCacheSeed(cached: AccountCacheWallet): WalletCacheSeed {
  return {
    addresses: cached.addresses,
    balanceMap: makeCachedBalanceMap(cached.balances),
    enabledTokenIds: cached.enabledTokenIds,
    fiatCurrencyCode: cached.fiatCurrencyCode,
    name: cached.name,
    otherMethodNames: cached.otherMethodNames,
    publicWalletInfo: cached.walletInfo
  }
}

/**
 * Reads one wallet's seed for a pixie that the bulk seed missed:
 * a cold login, or a wallet reactivated mid-session. Prefers the
 * consolidated account file, which holds every wallet the account
 * still has (archived ones included), and falls back to the
 * per-wallet pair a pre-consolidation device still has on disk.
 */
export async function loadWalletCacheSeed(
  ai: ApiInput,
  walletId: string,
  accountId: string
): Promise<WalletCacheSeed | undefined> {
  const accountState = ai.props.state.accounts[accountId]
  if (accountState != null) {
    const { cache } = await loadAccountCache(
      makeLocalDisklet(ai.props.io, accountState.accountWalletInfo.id)
    )
    const cached = cache?.wallets[walletId]
    if (cached != null) return toWalletCacheSeed(cached)
  }
  return await loadWalletFilesSeed(ai, walletId)
}

/**
 * Reads one wallet's own cache files from its local disklet.
 * Returns undefined when either file is missing or invalid
 * (first login, schema bump, corruption). Only a device that has not
 * yet written the consolidated account file still has these.
 */
export async function loadWalletFilesSeed(
  ai: ApiInput,
  walletId: string
): Promise<WalletCacheSeed | undefined> {
  const cacheDisklet = makeLocalDisklet(ai.props.io, walletId)
  const [publicKeyCache, walletCache] = await Promise.all([
    publicKeyFile.load(cacheDisklet, PUBLIC_KEY_CACHE),
    walletCacheFile.load(cacheDisklet, WALLET_CACHE_FILE)
  ])
  if (publicKeyCache == null || walletCache == null) return

  return {
    addresses: walletCache.addresses,
    otherMethodNames: walletCache.otherMethodNames,
    balanceMap: makeCachedBalanceMap(walletCache.balances),
    enabledTokenIds: walletCache.enabledTokenIds,
    fiatCurrencyCode: walletCache.fiatCurrencyCode,
    name: walletCache.name,
    publicWalletInfo: publicKeyCache.walletInfo
  }
}

/**
 * Seeds every wallet the account cache file already carried, with no
 * disk reads at all: the consolidated file was read in one go by the
 * account pixie. This is the warm path once a device has written the
 * current schema; `bulkLoadWalletCaches` below is the migration path
 * for a device whose wallets are still in their own files.
 */
export function seedWalletCachesFromAccount(
  ai: ApiInput,
  accountId: string,
  wallets: { [walletId: string]: AccountCacheWallet }
): void {
  // The file also carries wallets that are merely archived, so they
  // keep their cached state; only the active ones have a pixie to
  // seed. An archived wallet that is turned back on seeds itself
  // through `loadWalletCacheSeed`, which reads this same file:
  const activeWalletIds =
    ai.props.state.accounts[accountId]?.activeWalletIds ?? []
  const seeds: { [walletId: string]: WalletCacheSeed } = {}
  for (const walletId of activeWalletIds) {
    const cached = wallets[walletId]
    if (cached != null) seeds[walletId] = toWalletCacheSeed(cached)
  }

  ai.props.dispatch({
    type: 'CURRENCY_WALLETS_CACHE_LOADED',
    payload: { accountId, seeds }
  })

  if (walletCacheLoaderHooks.onBulkSeed != null) {
    walletCacheLoaderHooks.onBulkSeed(Object.keys(seeds))
  }
}

/**
 * Reads every active wallet's cache files concurrently and seeds
 * them all in a single `CURRENCY_WALLETS_CACHE_LOADED` dispatch,
 * so a warm login costs one store tick for the whole wallet list
 * instead of two dispatches per wallet. Wallets without valid cache
 * files are simply absent from the payload; their pixies fall back
 * to their own reads. Always dispatches, even with zero seeds, since
 * the wallet pixies are holding for `bulkWalletSeedPending` to clear.
 */
export async function bulkLoadWalletCaches(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const seeds: { [walletId: string]: WalletCacheSeed } = {}
  try {
    const accountState = ai.props.state.accounts[accountId]
    if (accountState == null) return
    const { activeWalletIds } = accountState

    await Promise.all(
      activeWalletIds.map(async walletId => {
        const seed = await loadWalletFilesSeed(ai, walletId).catch(() => {
          // A broken read just means this wallet boots cold:
          return undefined
        })
        if (seed != null) seeds[walletId] = seed
      })
    )
  } catch (error: unknown) {
    // Never skip the dispatch below: wallet pixies are holding for
    // `bulkWalletSeedPending` to clear, and an empty seed table just
    // sends them to their own fallback reads:
    ai.props.log.warn(`Bulk wallet-cache load failed: ${String(error)}`)
  }

  // The account may have logged out while we read the disk:
  if (ai.props.state.accounts[accountId] == null) return

  ai.props.dispatch({
    type: 'CURRENCY_WALLETS_CACHE_LOADED',
    payload: { accountId, seeds }
  })

  if (walletCacheLoaderHooks.onBulkSeed != null) {
    walletCacheLoaderHooks.onBulkSeed(Object.keys(seeds))
  }
}

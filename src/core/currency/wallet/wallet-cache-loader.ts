import { EdgeBalanceMap } from '../../../types/types'
import { makeJsonFile } from '../../../util/file-helpers'
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
 * mutable-config pattern as `walletCacheSaverConfig`.
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
 * Reads one wallet's cache files from its local disklet.
 * Returns undefined when either file is missing or invalid
 * (first login, schema bump, corruption).
 */
export async function loadWalletCacheSeed(
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
    balanceMap: makeCachedBalanceMap(walletCache.balances),
    enabledTokenIds: walletCache.enabledTokenIds,
    fiatCurrencyCode: walletCache.fiatCurrencyCode,
    name: walletCache.name,
    publicWalletInfo: publicKeyCache.walletInfo
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
        const seed = await loadWalletCacheSeed(ai, walletId).catch(() => {
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

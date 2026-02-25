import { asJSON } from 'cleaners'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgePluginMap
} from '../../types/types'
import { asWalletCacheFile, WalletCacheFile } from './cache-wallet-cleaners'
import {
  CachedCurrencyConfigOptions,
  makeCachedCurrencyConfig
} from './cached-currency-config'
import {
  CachedWalletOptions,
  makeCachedCurrencyWallet
} from './cached-currency-wallet'

/**
 * Result of loading wallet cache, containing all data needed to
 * display cached wallets before real engines are loaded.
 */
export interface WalletCacheSetup {
  /** Map of wallet ID to cached wallet object */
  currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
  /** List of active wallet IDs in display order */
  activeWalletIds: string[]
  /** Cached balances per wallet for reducer initialization (tokenId string → nativeAmount) */
  cachedBalances: { [walletId: string]: { [tokenId: string]: string } }
  /** Cleanup function to stop all active pollers */
  cleanup: () => void
}

/**
 * Callback to get a real wallet by ID for delegation.
 * Returns undefined if the real wallet is not yet available.
 */
type RealWalletLookup = (walletId: string) => EdgeCurrencyWallet | undefined

/**
 * Callback to get a real config by pluginId for delegation.
 * Returns undefined if the real config is not yet available.
 */
type RealConfigLookup = (pluginId: string) => EdgeCurrencyConfig | undefined

/**
 * Options for loading wallet cache.
 */
export interface LoadWalletCacheOptions {
  /** Map of walletId to options for cached wallet creation */
  walletOptions?: { [walletId: string]: CachedWalletOptions }
  /** Callback to look up real wallets for delegation */
  getRealWallet?: RealWalletLookup
  /** Callback to look up real configs for delegation */
  getRealConfig?: RealConfigLookup
  /** If true, cached wallets start paused (matching the login option) */
  pauseWallets?: boolean
}

/**
 * Loads wallet cache data from a JSON string and creates cached wallet objects.
 * @param jsonData The raw JSON string containing wallet cache data
 * @param currencyInfos Map of pluginId to EdgeCurrencyInfo for available plugins
 * @param options Optional configuration for cached wallet creation
 * @returns Setup data for cached wallets including wallets and active IDs
 */
export function loadWalletCache(
  jsonData: string,
  currencyInfos: EdgePluginMap<EdgeCurrencyInfo>,
  options: LoadWalletCacheOptions = {}
): WalletCacheSetup {
  const {
    walletOptions = {},
    getRealWallet,
    getRealConfig,
    pauseWallets
  } = options

  // Parse and validate the wallet cache file.
  // asJSON wraps SyntaxError with context and avoids untyped `any` from JSON.parse:
  const asWalletCacheJson = asJSON(asWalletCacheFile)
  const cacheFile: WalletCacheFile = asWalletCacheJson(jsonData)

  // Create currency configs for each plugin that has wallets
  const currencyConfigs: EdgePluginMap<EdgeCurrencyConfig> = {}
  const pluginIds = new Set(cacheFile.wallets.map(w => w.pluginId))
  const cleanupFunctions: Array<() => void> = []

  for (const pluginId of pluginIds) {
    const currencyInfo = currencyInfos[pluginId]
    if (currencyInfo == null) {
      continue
    }

    // Create the cached config with real config lookup for delegation
    const cachedConfigOptions: CachedCurrencyConfigOptions = {
      getRealConfig:
        getRealConfig != null ? () => getRealConfig(pluginId) : undefined
    }
    const { config, cleanup } = makeCachedCurrencyConfig(
      pluginId,
      currencyInfo,
      cacheFile,
      cachedConfigOptions
    )
    currencyConfigs[pluginId] = config
    cleanupFunctions.push(cleanup)
  }

  // Extract cached balances for reducer initialization
  const cachedBalances: {
    [walletId: string]: { [tokenId: string]: string }
  } = {}
  for (const cachedWallet of cacheFile.wallets) {
    cachedBalances[cachedWallet.id] = cachedWallet.balances
  }

  // Create cached wallets
  const currencyWallets: { [walletId: string]: EdgeCurrencyWallet } = {}
  const activeWalletIds: string[] = []

  for (const cachedWallet of cacheFile.wallets) {
    const { pluginId, id: walletId } = cachedWallet
    const currencyConfig = currencyConfigs[pluginId]
    const currencyInfo = currencyInfos[pluginId]

    if (currencyConfig == null || currencyInfo == null) {
      continue
    }

    // Create the cached wallet with real wallet lookup for delegation
    const cachedWalletOptions: CachedWalletOptions = {
      ...walletOptions[walletId],
      getRealWallet:
        getRealWallet != null ? () => getRealWallet(walletId) : undefined,
      pauseWallets
    }
    const { wallet, cleanup } = makeCachedCurrencyWallet(
      cachedWallet,
      currencyInfo,
      currencyConfig,
      cachedWalletOptions
    )
    currencyWallets[walletId] = wallet
    cleanupFunctions.push(cleanup)
    activeWalletIds.push(walletId)
  }

  return {
    currencyWallets,
    activeWalletIds,
    cachedBalances,
    cleanup: () => {
      for (const cleanupFn of cleanupFunctions) {
        cleanupFn()
      }
    }
  }
}

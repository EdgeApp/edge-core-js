import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgePluginMap
} from '../../types/types'
import {
  asWalletCacheFile,
  CachedSubscribedAddress,
  WalletCacheFile
} from './cache-wallet-cleaners'
import { makeCachedCurrencyConfig } from './cached-currency-config'
import {
  CachedWalletOptions,
  makeCachedCurrencyWallet
} from './cached-currency-wallet'

export interface WalletSubscriptionData {
  walletId: string
  subscribedAddresses: CachedSubscribedAddress[]
  seenTxCheckpoint?: string
}

export interface WalletCacheSetup {
  currencyConfigs: EdgePluginMap<EdgeCurrencyConfig>
  currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
  activeWalletIds: string[]
  walletSubscriptions: WalletSubscriptionData[]
}

export interface LoadWalletCacheOptions {
  /** Map of walletId to options for cached wallet creation (including engine creators) */
  walletOptions?: { [walletId: string]: CachedWalletOptions }
}

/**
 * Loads wallet cache data from a JSON string and creates cached wallet objects.
 * @param jsonData The raw JSON string containing wallet cache data
 * @param currencyInfos Map of pluginId to EdgeCurrencyInfo for available plugins
 * @param options Optional configuration including engine creators for lazy instantiation
 * @returns Setup data for cached wallets including configs, wallets, and active IDs
 */
export function loadWalletCache(
  jsonData: string,
  currencyInfos: EdgePluginMap<EdgeCurrencyInfo>,
  options: LoadWalletCacheOptions = {}
): WalletCacheSetup {
  const { walletOptions = {} } = options
  console.log('[WalletCache] Loading wallet cache data...')

  // Parse and validate the wallet cache file
  const cacheFile: WalletCacheFile = asWalletCacheFile(JSON.parse(jsonData))

  console.log(`[WalletCache] Found ${cacheFile.wallets.length} wallets`)

  // Create currency configs for each plugin that has wallets
  const currencyConfigs: EdgePluginMap<EdgeCurrencyConfig> = {}
  const pluginIds = new Set(cacheFile.wallets.map(w => w.pluginId))

  for (const pluginId of pluginIds) {
    const currencyInfo = currencyInfos[pluginId]
    if (currencyInfo == null) {
      console.warn(`[WalletCache] Unknown pluginId: ${pluginId}, skipping`)
      continue
    }

    currencyConfigs[pluginId] = makeCachedCurrencyConfig(
      pluginId,
      currencyInfo,
      cacheFile
    )
    console.log(`[WalletCache] Created config for ${pluginId}`)
  }

  // Create cached wallets and collect subscription data
  const currencyWallets: { [walletId: string]: EdgeCurrencyWallet } = {}
  const activeWalletIds: string[] = []
  const walletSubscriptions: WalletSubscriptionData[] = []

  // Plugins that have engine-dependent otherMethods should be excluded from cache
  // because the GUI may call these methods during cache mode
  const pluginsWithOtherMethods = new Set(['fio'])

  for (const cachedWallet of cacheFile.wallets) {
    const { pluginId, id: walletId } = cachedWallet
    const currencyConfig = currencyConfigs[pluginId]
    const currencyInfo = currencyInfos[pluginId]

    if (currencyConfig == null || currencyInfo == null) {
      console.warn(
        `[WalletCache] Skipping wallet ${walletId} - no config for ${pluginId}`
      )
      continue
    }

    // Skip wallets with engine-dependent otherMethods
    if (pluginsWithOtherMethods.has(pluginId)) {
      console.log(
        `[WalletCache] Skipping wallet ${walletId.slice(0, 8)}... (${currencyInfo.currencyCode}) - has otherMethods`
      )
      continue
    }

    currencyWallets[walletId] = makeCachedCurrencyWallet(
      cachedWallet,
      currencyInfo,
      currencyConfig,
      walletOptions[walletId]
    )
    activeWalletIds.push(walletId)

    // Collect subscription data for change server
    if (
      cachedWallet.subscribedAddresses != null &&
      cachedWallet.subscribedAddresses.length > 0
    ) {
      walletSubscriptions.push({
        walletId,
        subscribedAddresses: cachedWallet.subscribedAddresses,
        seenTxCheckpoint: cachedWallet.seenTxCheckpoint
      })
    }

    console.log(
      `[WalletCache] Created wallet ${walletId.slice(0, 8)}... (${
        currencyInfo.currencyCode
      })`
    )
  }

  console.log(
    `[WalletCache] Setup complete: ${activeWalletIds.length} wallets active, ${walletSubscriptions.length} with subscriptions`
  )

  return {
    currencyConfigs,
    currencyWallets,
    activeWalletIds,
    walletSubscriptions
  }
}

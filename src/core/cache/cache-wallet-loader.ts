import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgePluginMap
} from '../../types/types'
import { asWalletCacheFile, WalletCacheFile } from './cache-wallet-cleaners'
import { makeCachedCurrencyConfig } from './cached-currency-config'
import {
  CachedWalletOptions,
  makeCachedCurrencyWallet
} from './cached-currency-wallet'

const LOG_PREFIX = '[WalletCache]'

/**
 * Plugins with engine-dependent otherMethods that cannot be safely cached.
 * These plugins require the real engine to be running for GUI operations.
 */
const PLUGINS_WITH_ENGINE_METHODS = ['fio'] as const

/** Number of characters to show when logging wallet IDs */
const WALLET_ID_DISPLAY_LENGTH = 8

export interface WalletCacheSetup {
  currencyConfigs: EdgePluginMap<EdgeCurrencyConfig>
  currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
  activeWalletIds: string[]
}

/**
 * Callback to get a real wallet by ID for delegation.
 * Returns undefined if the real wallet is not yet available.
 */
export type RealWalletLookup = (
  walletId: string
) => EdgeCurrencyWallet | undefined

export interface LoadWalletCacheOptions {
  /** Map of walletId to options for cached wallet creation */
  walletOptions?: { [walletId: string]: CachedWalletOptions }
  /** Callback to look up real wallets for delegation */
  getRealWallet?: RealWalletLookup
}

/**
 * Loads wallet cache data from a JSON string and creates cached wallet objects.
 * @param jsonData The raw JSON string containing wallet cache data
 * @param currencyInfos Map of pluginId to EdgeCurrencyInfo for available plugins
 * @param options Optional configuration for cached wallet creation
 * @returns Setup data for cached wallets including configs, wallets, and active IDs
 */
export function loadWalletCache(
  jsonData: string,
  currencyInfos: EdgePluginMap<EdgeCurrencyInfo>,
  options: LoadWalletCacheOptions = {}
): WalletCacheSetup {
  const { walletOptions = {}, getRealWallet } = options
  console.warn(`${LOG_PREFIX} Loading wallet cache data...`)

  // Parse and validate the wallet cache file
  const cacheFile: WalletCacheFile = asWalletCacheFile(JSON.parse(jsonData))

  console.warn(
    `${LOG_PREFIX} Found ${cacheFile.wallets.length} wallets in cache file`
  )

  // Create currency configs for each plugin that has wallets
  const currencyConfigs: EdgePluginMap<EdgeCurrencyConfig> = {}
  const pluginIds = new Set(cacheFile.wallets.map(w => w.pluginId))

  for (const pluginId of pluginIds) {
    const currencyInfo = currencyInfos[pluginId]
    if (currencyInfo == null) {
      console.warn(`${LOG_PREFIX} Unknown pluginId: ${pluginId}, skipping`)
      continue
    }

    currencyConfigs[pluginId] = makeCachedCurrencyConfig(
      pluginId,
      currencyInfo,
      cacheFile
    )
    console.warn(`${LOG_PREFIX} Created config for ${pluginId}`)
  }

  // Create cached wallets
  const currencyWallets: { [walletId: string]: EdgeCurrencyWallet } = {}
  const activeWalletIds: string[] = []

  // Exclude plugins that have engine-dependent otherMethods because
  // the GUI may call these methods during cache mode before engines load.
  const pluginsWithOtherMethods: Set<string> = new Set(
    PLUGINS_WITH_ENGINE_METHODS
  )

  for (const cachedWallet of cacheFile.wallets) {
    const { pluginId, id: walletId } = cachedWallet
    const currencyConfig = currencyConfigs[pluginId]
    const currencyInfo = currencyInfos[pluginId]

    if (currencyConfig == null || currencyInfo == null) {
      console.warn(
        `${LOG_PREFIX} Skipping wallet ${walletId} - no config for ${pluginId}`
      )
      continue
    }

    // Skip wallets with engine-dependent otherMethods
    if (pluginsWithOtherMethods.has(pluginId)) {
      console.warn(
        `${LOG_PREFIX} Skipping wallet ${walletId.slice(
          0,
          WALLET_ID_DISPLAY_LENGTH
        )}... (${currencyInfo.currencyCode}) - has otherMethods`
      )
      continue
    }

    // Create the cached wallet with real wallet lookup for delegation
    const cachedWalletOptions: CachedWalletOptions = {
      ...walletOptions[walletId],
      getRealWallet:
        getRealWallet != null ? () => getRealWallet(walletId) : undefined
    }
    currencyWallets[walletId] = makeCachedCurrencyWallet(
      cachedWallet,
      currencyInfo,
      currencyConfig,
      cachedWalletOptions
    )
    activeWalletIds.push(walletId)

    console.warn(
      `${LOG_PREFIX} Created wallet ${walletId.slice(
        0,
        WALLET_ID_DISPLAY_LENGTH
      )}... (${currencyInfo.currencyCode})`
    )
  }

  console.warn(
    `${LOG_PREFIX} Setup complete: ${activeWalletIds.length} wallets active`
  )

  return {
    currencyConfigs,
    currencyWallets,
    activeWalletIds
  }
}

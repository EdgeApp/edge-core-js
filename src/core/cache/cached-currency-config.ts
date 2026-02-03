import { bridgifyObject, watchMethod } from 'yaob'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeGetTokenDetailsFilter,
  EdgeToken,
  EdgeTokenMap
} from '../../types/types'
import {
  createDelegatingOtherMethods,
  makeRealObjectPoller
} from './cache-utils'
import { WalletCacheFile } from './cache-wallet-cleaners'

/**
 * Options for creating a cached currency config.
 */
export interface CachedCurrencyConfigOptions {
  /** Callback to get the real config for delegation */
  getRealConfig?: () => EdgeCurrencyConfig | undefined
}

/**
 * Creates a cached EdgeCurrencyConfig for a plugin.
 * Used for cache-first login without real plugin instantiation.
 */
export function makeCachedCurrencyConfig(
  pluginId: string,
  currencyInfo: EdgeCurrencyInfo,
  cacheFile: WalletCacheFile,
  options: CachedCurrencyConfigOptions = {}
): EdgeCurrencyConfig {
  const { getRealConfig } = options

  // Shared poller: single poll loop for all callers
  const poller = makeRealObjectPoller<EdgeCurrencyConfig>(() => {
    if (getRealConfig == null) return undefined
    const realConfig = getRealConfig()
    // Don't delegate to self
    if (realConfig != null && realConfig !== config) {
      return realConfig
    }
    return undefined
  }, `config ${pluginId}`)

  const { tryGet: tryGetRealConfig, waitFor: waitForRealConfig } = poller

  /**
   * Delegates an async method call to the real config.
   */
  async function delegate<R>(
    fn: (c: EdgeCurrencyConfig) => Promise<R>
  ): Promise<R> {
    const immediate = tryGetRealConfig()
    if (immediate != null) return await fn(immediate)
    return await fn(await waitForRealConfig())
  }

  // Build token map from cached data (cached tokens are EdgeTokens)
  const allTokens: EdgeTokenMap = cacheFile.tokens[pluginId] ?? {}

  // Get otherMethods names for this plugin
  const otherMethodNames = cacheFile.configOtherMethodNames[pluginId] ?? []

  const config: EdgeCurrencyConfig = {
    watch: watchMethod,

    currencyInfo,

    // Tokens (read-only, can be cached):
    get allTokens(): EdgeTokenMap {
      return allTokens
    },
    get builtinTokens(): EdgeTokenMap {
      return allTokens
    },
    get customTokens(): EdgeTokenMap {
      return {}
    },

    // Token methods (need real config, delegate):
    async getTokenDetails(
      filter: EdgeGetTokenDetailsFilter
    ): Promise<EdgeToken[]> {
      return await delegate(async c => await c.getTokenDetails(filter))
    },

    async getTokenId(token: EdgeToken): Promise<string> {
      return await delegate(async c => await c.getTokenId(token))
    },

    async addCustomToken(token: EdgeToken): Promise<string> {
      return await delegate(async c => await c.addCustomToken(token))
    },

    async changeCustomToken(tokenId: string, token: EdgeToken): Promise<void> {
      return await delegate(
        async c => await c.changeCustomToken(tokenId, token)
      )
    },

    async removeCustomToken(tokenId: string): Promise<void> {
      return await delegate(async c => await c.removeCustomToken(tokenId))
    },

    // Always-enabled tokens (read-only cached, write delegates):
    get alwaysEnabledTokenIds(): string[] {
      return []
    },

    async changeAlwaysEnabledTokenIds(tokenIds: string[]): Promise<void> {
      return await delegate(
        async c => await c.changeAlwaysEnabledTokenIds(tokenIds)
      )
    },

    // User settings (read-only cached, write delegates):
    get userSettings(): object | undefined {
      return {}
    },

    async changeUserSettings(settings: object): Promise<void> {
      return await delegate(async c => await c.changeUserSettings(settings))
    },

    // Utility methods (need real config, delegate):
    async importKey(
      userInput: string,
      opts?: { keyOptions?: object }
    ): Promise<object> {
      return await delegate(async c => await c.importKey(userInput, opts))
    },

    // Generic - create delegating stubs for otherMethods
    otherMethods: createDelegatingOtherMethods(
      otherMethodNames,
      () => tryGetRealConfig()?.otherMethods,
      waitForRealConfig
    )
  }

  return bridgifyObject(config)
}

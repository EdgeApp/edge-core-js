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
 * Result of creating a cached currency config.
 */
export interface CachedCurrencyConfigResult {
  config: EdgeCurrencyConfig
  cleanup: () => void
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
): CachedCurrencyConfigResult {
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

  const {
    tryGet: tryGetRealConfig,
    waitFor: waitForRealConfig,
    cancel: cancelPoller
  } = poller

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

  // Build token maps from cached data (cached tokens are EdgeTokens)
  const allTokens: EdgeTokenMap = cacheFile.tokens[pluginId] ?? {}
  const customTokens: EdgeTokenMap = cacheFile.customTokens[pluginId] ?? {}
  // Compute builtinTokens by excluding custom tokens from allTokens
  const builtinTokens: EdgeTokenMap = Object.fromEntries(
    Object.entries(allTokens).filter(
      ([tokenId]) => customTokens[tokenId] == null
    )
  )

  // Get otherMethods names for this plugin
  const otherMethodNames = cacheFile.configOtherMethodNames[pluginId] ?? []

  const config: EdgeCurrencyConfig = {
    watch: watchMethod,

    currencyInfo,

    // Tokens (delegate to real config when available, fall back to cache):
    get allTokens(): EdgeTokenMap {
      const realConfig = tryGetRealConfig()
      return realConfig != null ? realConfig.allTokens : allTokens
    },
    get builtinTokens(): EdgeTokenMap {
      const realConfig = tryGetRealConfig()
      return realConfig != null ? realConfig.builtinTokens : builtinTokens
    },
    get customTokens(): EdgeTokenMap {
      const realConfig = tryGetRealConfig()
      return realConfig != null ? realConfig.customTokens : customTokens
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

    // Always-enabled tokens (delegate when available, write delegates):
    get alwaysEnabledTokenIds(): string[] {
      const realConfig = tryGetRealConfig()
      return realConfig != null ? realConfig.alwaysEnabledTokenIds : []
    },

    async changeAlwaysEnabledTokenIds(tokenIds: string[]): Promise<void> {
      return await delegate(
        async c => await c.changeAlwaysEnabledTokenIds(tokenIds)
      )
    },

    // User settings (delegate when available, write delegates):
    get userSettings(): object | undefined {
      const realConfig = tryGetRealConfig()
      return realConfig != null ? realConfig.userSettings : undefined
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
      waitForRealConfig,
      true // bridgify for config otherMethods
    )
  }

  return { config: bridgifyObject(config), cleanup: cancelPoller }
}

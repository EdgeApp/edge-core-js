import { bridgifyObject, watchMethod } from 'yaob'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeGetTokenDetailsFilter,
  EdgeToken,
  EdgeTokenMap
} from '../../types/types'
import { CachedToken, WalletCacheFile } from './cache-wallet-cleaners'

const LOG_PREFIX = '[WalletCache]'

/**
 * Converts cached token data to EdgeToken format.
 */
function cachedTokenToEdgeToken(cachedToken: CachedToken): EdgeToken {
  return {
    currencyCode: cachedToken.currencyCode,
    displayName: cachedToken.displayName,
    denominations: cachedToken.denominations,
    networkLocation: cachedToken.networkLocation
  }
}

/**
 * Creates a cached EdgeCurrencyConfig for a plugin.
 * Used for testing without real plugin instantiation.
 */
export function makeCachedCurrencyConfig(
  pluginId: string,
  currencyInfo: EdgeCurrencyInfo,
  cacheFile: WalletCacheFile
): EdgeCurrencyConfig {
  // Build token map from cached data
  const cachedTokens = cacheFile.tokens[pluginId] ?? {}
  const allTokens: EdgeTokenMap = {}
  for (const [tokenId, cachedToken] of Object.entries(cachedTokens)) {
    allTokens[tokenId] = cachedTokenToEdgeToken(cachedToken)
  }

  const config: EdgeCurrencyConfig = {
    watch: watchMethod,

    currencyInfo,

    // Tokens:
    get allTokens(): EdgeTokenMap {
      return allTokens
    },
    get builtinTokens(): EdgeTokenMap {
      return allTokens
    },
    get customTokens(): EdgeTokenMap {
      return {}
    },

    async getTokenDetails(
      _filter: EdgeGetTokenDetailsFilter
    ): Promise<EdgeToken[]> {
      console.log(`${LOG_PREFIX} ${pluginId}.getTokenDetails()`)
      return []
    },

    async getTokenId(token: EdgeToken): Promise<string> {
      console.log(`${LOG_PREFIX} ${pluginId}.getTokenId()`)
      // Return a simple hash based on the token's network location
      if (token.networkLocation != null) {
        const contractAddress = (
          token.networkLocation as { contractAddress?: string }
        ).contractAddress
        if (contractAddress != null) {
          return contractAddress.toLowerCase()
        }
      }
      return token.currencyCode.toLowerCase()
    },

    async addCustomToken(_token: EdgeToken): Promise<string> {
      console.log(`${LOG_PREFIX} ${pluginId}.addCustomToken()`)
      throw new Error('Cached config does not support adding custom tokens')
    },

    async changeCustomToken(
      _tokenId: string,
      _token: EdgeToken
    ): Promise<void> {
      console.log(`${LOG_PREFIX} ${pluginId}.changeCustomToken()`)
      throw new Error('Cached config does not support changing custom tokens')
    },

    async removeCustomToken(_tokenId: string): Promise<void> {
      console.log(`${LOG_PREFIX} ${pluginId}.removeCustomToken()`)
      throw new Error('Cached config does not support removing custom tokens')
    },

    // Always-enabled tokens:
    get alwaysEnabledTokenIds(): string[] {
      return []
    },

    async changeAlwaysEnabledTokenIds(_tokenIds: string[]): Promise<void> {
      console.log(`${LOG_PREFIX} ${pluginId}.changeAlwaysEnabledTokenIds()`)
    },

    // User settings:
    get userSettings(): object | undefined {
      return {}
    },

    async changeUserSettings(_settings: object): Promise<void> {
      console.log(`${LOG_PREFIX} ${pluginId}.changeUserSettings()`)
    },

    // Utility methods:
    async importKey(
      _userInput: string,
      _opts?: { keyOptions?: object }
    ): Promise<object> {
      console.log(`${LOG_PREFIX} ${pluginId}.importKey()`)
      throw new Error('Cached config does not support importing keys')
    },

    otherMethods: {}
  }

  return bridgifyObject(config)
}

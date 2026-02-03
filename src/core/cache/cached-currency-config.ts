import { asObject, asOptional, asString, Cleaner } from 'cleaners'
import { bridgifyObject, watchMethod } from 'yaob'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeGetTokenDetailsFilter,
  EdgeToken,
  EdgeTokenMap
} from '../../types/types'
import { WalletCacheFile } from './cache-wallet-cleaners'

const LOG_PREFIX = '[WalletCache]'

// Cleaner for safely extracting contractAddress from networkLocation
const asMaybeContractAddress: Cleaner<{ contractAddress?: string }> = asObject({
  contractAddress: asOptional(asString)
})

/**
 * Creates a cached EdgeCurrencyConfig for a plugin.
 * Used for cache-first login without real plugin instantiation.
 */
export function makeCachedCurrencyConfig(
  pluginId: string,
  currencyInfo: EdgeCurrencyInfo,
  cacheFile: WalletCacheFile
): EdgeCurrencyConfig {
  // Build token map from cached data (cached tokens are EdgeTokens)
  const allTokens: EdgeTokenMap = cacheFile.tokens[pluginId] ?? {}

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
      console.warn(`${LOG_PREFIX} ${pluginId}.getTokenDetails() - cached mode`)
      return []
    },

    async getTokenId(token: EdgeToken): Promise<string> {
      console.warn(`${LOG_PREFIX} ${pluginId}.getTokenId() - cached mode`)
      // Return a simple ID based on the token's network location (if available)
      if (token.networkLocation != null) {
        try {
          const { contractAddress } = asMaybeContractAddress(
            token.networkLocation
          )
          if (contractAddress != null) {
            return contractAddress.toLowerCase()
          }
        } catch {
          // networkLocation doesn't have contractAddress, fall through
        }
      }
      return token.currencyCode.toLowerCase()
    },

    async addCustomToken(_token: EdgeToken): Promise<string> {
      console.warn(`${LOG_PREFIX} ${pluginId}.addCustomToken() - cached mode`)
      throw new Error('Cached config does not support adding custom tokens')
    },

    async changeCustomToken(
      _tokenId: string,
      _token: EdgeToken
    ): Promise<void> {
      console.warn(
        `${LOG_PREFIX} ${pluginId}.changeCustomToken() - cached mode`
      )
      throw new Error('Cached config does not support changing custom tokens')
    },

    async removeCustomToken(_tokenId: string): Promise<void> {
      console.warn(
        `${LOG_PREFIX} ${pluginId}.removeCustomToken() - cached mode`
      )
      throw new Error('Cached config does not support removing custom tokens')
    },

    // Always-enabled tokens:
    get alwaysEnabledTokenIds(): string[] {
      return []
    },

    async changeAlwaysEnabledTokenIds(_tokenIds: string[]): Promise<void> {
      console.warn(
        `${LOG_PREFIX} ${pluginId}.changeAlwaysEnabledTokenIds() - cached mode`
      )
    },

    // User settings:
    get userSettings(): object | undefined {
      return {}
    },

    async changeUserSettings(_settings: object): Promise<void> {
      console.warn(
        `${LOG_PREFIX} ${pluginId}.changeUserSettings() - cached mode`
      )
    },

    // Utility methods:
    async importKey(
      _userInput: string,
      _opts?: { keyOptions?: object }
    ): Promise<object> {
      console.warn(`${LOG_PREFIX} ${pluginId}.importKey() - cached mode`)
      throw new Error('Cached config does not support importing keys')
    },

    otherMethods: {}
  }

  return bridgifyObject(config)
}

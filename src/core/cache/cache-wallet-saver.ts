import { Disklet } from 'disklet'

import { EdgeAccount } from '../../types/types'
import { makePeriodicTask, PeriodicTask } from '../../util/periodic-task'
import { CachedToken, WalletCacheFile } from './cache-wallet-cleaners'

const THROTTLE_MS = 5000 // 5 seconds

/**
 * Converts an EdgeToken to the cached format.
 */
function edgeTokenToCachedToken(token: {
  currencyCode: string
  displayName: string
  denominations: Array<{ multiplier: string; name: string; symbol?: string }>
  networkLocation?: object
}): CachedToken {
  return {
    currencyCode: token.currencyCode,
    displayName: token.displayName,
    denominations: token.denominations.map(d => ({
      multiplier: d.multiplier,
      name: d.name,
      symbol: d.symbol
    })),
    networkLocation: token.networkLocation
  }
}

/**
 * Creates a throttled wallet cache saver that automatically saves
 * the cache when values change, at most once every 5 seconds.
 */
export function makeWalletCacheSaver(
  account: EdgeAccount,
  disklet: Disklet,
  cachePath: string,
  getSubscriptions: (
    walletId: string
  ) => Array<{ address: string; checkpoint?: string }>,
  getSeenTxCheckpoint: (walletId: string) => string | null
): {
  markDirty: () => void
  stop: () => void
} {
  let isDirty = false
  let isSaving = false
  let saveTask: PeriodicTask | undefined

  async function doSave(): Promise<void> {
    if (isSaving || !isDirty) return
    isSaving = true
    isDirty = false

    try {
      // Build token map from all currency configs:
      const tokens: WalletCacheFile['tokens'] = {}
      for (const [pluginId, config] of Object.entries(account.currencyConfig)) {
        const pluginTokens: { [tokenId: string]: CachedToken } = {}
        for (const [tokenId, token] of Object.entries(config.allTokens)) {
          pluginTokens[tokenId] = edgeTokenToCachedToken(token)
        }
        if (Object.keys(pluginTokens).length > 0) {
          tokens[pluginId] = pluginTokens
        }
      }

      // Build wallet array from active wallets:
      const wallets: WalletCacheFile['wallets'] = []
      for (const walletId of account.activeWalletIds) {
        const wallet = account.currencyWallets[walletId]
        if (wallet == null) continue

        // Convert balanceMap to balances object:
        const balances: { [tokenId: string]: string } = {}
        for (const [tokenId, balance] of wallet.balanceMap) {
          const key = tokenId ?? 'null'
          balances[key] = balance
        }

        // Get custom tokens:
        const customTokens: { [tokenId: string]: CachedToken } = {}
        const config = wallet.currencyConfig
        for (const [tokenId, token] of Object.entries(config.customTokens)) {
          customTokens[tokenId] = edgeTokenToCachedToken(token)
        }

        // Get subscriptions and checkpoint
        const subscriptions = getSubscriptions(walletId)
        const seenTxCheckpoint = getSeenTxCheckpoint(walletId)

        // Map subscriptions to include explicit checkpoint field
        const subscribedAddresses =
          subscriptions.length > 0
            ? subscriptions.map(sub => ({
                address: sub.address,
                checkpoint: sub.checkpoint
              }))
            : undefined

        wallets.push({
          id: wallet.id,
          type: wallet.type,
          name: wallet.name ?? undefined,
          pluginId: wallet.currencyInfo.pluginId,
          fiatCurrencyCode: wallet.fiatCurrencyCode,
          balances,
          enabledTokenIds: wallet.enabledTokenIds,
          customTokens,
          subscribedAddresses,
          seenTxCheckpoint: seenTxCheckpoint ?? undefined
        })
      }

      // Build the cache file:
      const cacheFile: WalletCacheFile = {
        version: 1,
        tokens,
        wallets
      }

      // Save to disk:
      const cacheJson = JSON.stringify(cacheFile, null, 2)
      await disklet.setText(cachePath, cacheJson)
    } catch (error) {
      console.warn('[WalletCacheSaver] Failed to save cache:', error)
      // Mark dirty again to retry on next interval
      isDirty = true
    } finally {
      isSaving = false
    }
  }

  // Create a periodic task that runs every 5 seconds
  saveTask = makePeriodicTask(doSave, THROTTLE_MS)
  saveTask.start()

  return {
    markDirty(): void {
      isDirty = true
    },
    stop(): void {
      if (saveTask != null) {
        saveTask.stop()
        saveTask = undefined
      }
    }
  }
}

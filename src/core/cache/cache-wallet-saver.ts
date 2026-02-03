import { Disklet } from 'disklet'

import { EdgeAccount, EdgeLog } from '../../types/types'
import { makePeriodicTask, PeriodicTask } from '../../util/periodic-task'
import { WalletCacheFile } from './cache-wallet-cleaners'

const THROTTLE_MS = 5000 // 5 seconds
const LOG_PREFIX = '[WalletCacheSaver]'
/** Key used in balances map for the parent currency (null tokenId) */
const PARENT_CURRENCY_KEY = 'null'

// Type for the log function
type LogFn = EdgeLog['warn']

export interface WalletCacheSaver {
  markDirty: () => void
  stop: () => void
}

/**
 * Creates a throttled wallet cache saver that automatically saves
 * the cache when values change, at most once every 5 seconds.
 */
export function makeWalletCacheSaver(
  account: EdgeAccount,
  disklet: Disklet,
  cachePath: string,
  log: LogFn
): WalletCacheSaver {
  let isDirty = false
  let isSaving = false
  let isStopped = false
  let saveTask: PeriodicTask | undefined

  async function doSave(): Promise<void> {
    // Guard: don't save if stopped or already saving
    if (isStopped || isSaving || !isDirty) return
    isSaving = true
    isDirty = false

    try {
      // Guard: verify account is still valid before accessing its properties
      // (currencyConfig and currencyWallets may throw if account is destroyed)
      if (account.activeWalletIds == null) {
        log(`${LOG_PREFIX} Skipping save: account no longer valid`)
        return
      }

      // First pass: Collect enabled token IDs per plugin from all active wallets.
      // We only cache tokens that are actually enabled by at least one wallet
      // to minimize cache size (chains like Ethereum have thousands of tokens).
      const enabledTokensByPlugin: { [pluginId: string]: Set<string> } = {}
      for (const walletId of account.activeWalletIds) {
        const wallet = account.currencyWallets[walletId]
        if (wallet == null) continue

        const pluginId = wallet.currencyInfo.pluginId
        if (enabledTokensByPlugin[pluginId] == null) {
          enabledTokensByPlugin[pluginId] = new Set()
        }
        for (const tokenId of wallet.enabledTokenIds) {
          enabledTokensByPlugin[pluginId].add(tokenId)
        }
      }

      // Build token map from only enabled tokens:
      const tokens: WalletCacheFile['tokens'] = {}
      for (const [pluginId, config] of Object.entries(account.currencyConfig)) {
        const enabledTokenIds = enabledTokensByPlugin[pluginId]
        if (enabledTokenIds == null || enabledTokenIds.size === 0) continue

        const pluginTokens: WalletCacheFile['tokens'][string] = {}
        for (const tokenId of enabledTokenIds) {
          const token = config.allTokens[tokenId]
          if (token != null) {
            pluginTokens[tokenId] = token
          }
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
          const key = tokenId ?? PARENT_CURRENCY_KEY
          balances[key] = balance
        }

        wallets.push({
          id: wallet.id,
          type: wallet.type,
          name: wallet.name ?? undefined,
          pluginId: wallet.currencyInfo.pluginId,
          fiatCurrencyCode: wallet.fiatCurrencyCode,
          balances,
          enabledTokenIds: wallet.enabledTokenIds
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
      log(
        `${LOG_PREFIX} Saved cache: ${wallets.length} wallets, ${
          Object.keys(tokens).length
        } plugins`
      )
    } catch (error: unknown) {
      log(`${LOG_PREFIX} Failed to save cache:`, error)
      // Mark dirty again to retry on next interval (unless stopped)
      if (!isStopped) isDirty = true
    } finally {
      isSaving = false
    }
  }

  // Create a periodic task that runs every 5 seconds
  saveTask = makePeriodicTask(doSave, THROTTLE_MS)
  saveTask.start()

  return {
    markDirty(): void {
      if (!isStopped) isDirty = true
    },
    stop(): void {
      isStopped = true
      if (saveTask != null) {
        saveTask.stop()
        saveTask = undefined
      }
    }
  }
}

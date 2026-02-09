import { Disklet } from 'disklet'

import { EdgeAccount, EdgeLog } from '../../types/types'
import {
  asWalletCacheFile,
  PARENT_CURRENCY_KEY,
  WalletCacheFile
} from './cache-wallet-cleaners'

/** Default minimum interval between saves: 5 seconds */
const DEFAULT_THROTTLE_MS = 5000
const MAX_CONSECUTIVE_FAILURES = 3
const LOG_PREFIX = '[WalletCacheSaver]'

/**
 * Test-only configuration for the wallet cache saver.
 * Set throttleMs to a low value (e.g. 50) in test setup to avoid long snoozes.
 */
export const walletCacheSaverConfig = {
  throttleMs: undefined as number | undefined
}

// Type for the log function
type LogFn = EdgeLog['warn']

/**
 * Interface for controlling the wallet cache saver.
 * Call markDirty() when wallet state changes to trigger a save.
 * Call stop() when the account is destroyed to clean up resources.
 */
export interface WalletCacheSaver {
  /** Mark the cache as dirty, triggering a save as soon as the throttle allows */
  markDirty: () => void
  /** Stop the saver and clean up resources */
  stop: () => void
}

export interface WalletCacheSaverOptions {
  /** Minimum interval between saves in ms (default 5000). */
  throttleMs?: number
}

/**
 * Creates a dirty-triggered throttled cache saver.
 *
 * When markDirty() is called:
 * - If enough time has passed since the last save (>= throttleMs),
 *   the save happens immediately.
 * - If a save happened recently, the save is scheduled for when the
 *   throttle window expires.
 *
 * This ensures changes are persisted as quickly as possible while
 * limiting disk writes to at most once per throttle interval.
 */
export function makeWalletCacheSaver(
  account: EdgeAccount,
  disklet: Disklet,
  cachePath: string,
  log: LogFn,
  opts: WalletCacheSaverOptions = {}
): WalletCacheSaver {
  const {
    throttleMs = walletCacheSaverConfig.throttleMs ?? DEFAULT_THROTTLE_MS
  } = opts
  let isDirty = false
  let isSaving = false
  let isStopped = false
  let consecutiveFailures = 0
  let lastSaveTime = 0
  let pendingTimeout: ReturnType<typeof setTimeout> | undefined

  async function doSave(): Promise<void> {
    if (isStopped || isSaving || !isDirty) return
    isSaving = true
    isDirty = false

    try {
      // Guard: verify account is still valid before accessing its properties.
      if (!account.loggedIn) {
        log(`${LOG_PREFIX} Skipping save: account no longer valid`)
        return
      }

      // Collect enabled token IDs per plugin from all active wallets.
      // Only cache tokens enabled by at least one wallet to minimize size.
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

      // Save config otherMethods names per plugin:
      const configOtherMethodNames: WalletCacheFile['configOtherMethodNames'] =
        {}
      for (const [pluginId, config] of Object.entries(account.currencyConfig)) {
        const methodNames = Object.keys(config.otherMethods)
        if (methodNames.length > 0) {
          configOtherMethodNames[pluginId] = methodNames
        }
      }

      // Build wallet array from active wallets:
      const wallets: WalletCacheFile['wallets'] = []
      for (const walletId of account.activeWalletIds) {
        const wallet = account.currencyWallets[walletId]
        if (wallet == null) continue

        const balances: { [tokenId: string]: string } = {}
        for (const [tokenId, balance] of wallet.balanceMap) {
          const key = tokenId ?? PARENT_CURRENCY_KEY
          balances[key] = balance
        }

        const otherMethodNames = Object.keys(wallet.otherMethods)

        wallets.push({
          id: wallet.id,
          type: wallet.type,
          name: wallet.name ?? undefined,
          pluginId: wallet.currencyInfo.pluginId,
          fiatCurrencyCode: wallet.fiatCurrencyCode,
          balances,
          enabledTokenIds: wallet.enabledTokenIds,
          otherMethodNames,
          created: (wallet.created ?? new Date()).toISOString(),
          publicWalletInfo: wallet.publicWalletInfo
        })
      }

      // Validate at write time so malformed data is caught immediately
      // rather than producing an unusable cache on next login:
      const cacheFile: WalletCacheFile = asWalletCacheFile({
        version: 1,
        tokens,
        wallets,
        configOtherMethodNames
      })

      const cacheJson = JSON.stringify(cacheFile, null, 2)
      await disklet.setText(cachePath, cacheJson)
      lastSaveTime = Date.now()
      log(
        `${LOG_PREFIX} Saved cache: ${wallets.length} wallets, ${
          Object.keys(tokens).length
        } plugins`
      )
      consecutiveFailures = 0
    } catch (error: unknown) {
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log(
          `${LOG_PREFIX} Failed to save cache ${consecutiveFailures} times, giving up:`,
          String(error)
        )
      } else {
        log(`${LOG_PREFIX} Failed to save cache:`, String(error))
        // Re-mark dirty to retry on next markDirty call:
        if (!isStopped) isDirty = true
      }
    } finally {
      isSaving = false

      // If more changes arrived while saving, schedule another save:
      if (isDirty && !isStopped) {
        scheduleSave()
      }
    }
  }

  /**
   * Schedules a save based on how long ago the last save was:
   * - If >= throttleMs has passed, save immediately.
   * - Otherwise, schedule for when the throttle window expires.
   * Only one pending timeout exists at a time.
   */
  function scheduleSave(): void {
    if (pendingTimeout != null) return // Already scheduled
    if (isStopped) return

    const elapsed = Date.now() - lastSaveTime
    if (elapsed >= throttleMs) {
      // Enough time has passed, save immediately (async):
      doSave().catch(() => {})
    } else {
      // Schedule save for when the throttle window expires:
      const delay = throttleMs - elapsed
      pendingTimeout = setTimeout(() => {
        pendingTimeout = undefined
        doSave().catch(() => {})
      }, delay)
    }
  }

  return {
    markDirty(): void {
      if (isStopped) return
      isDirty = true
      scheduleSave()
    },
    stop(): void {
      isStopped = true
      if (pendingTimeout != null) {
        clearTimeout(pendingTimeout)
        pendingTimeout = undefined
      }
    }
  }
}

import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  Cleaner
} from 'cleaners'

import { asBase16 } from '../../types/server-cleaners'
import {
  EdgeDenomination,
  EdgePluginMap,
  EdgeToken,
  EdgeTokenMap,
  EdgeWalletState,
  EdgeWalletStates
} from '../../types/types'
import { asJsonObject } from '../../util/file-helpers'
import { asIntegerString } from '../currency/wallet/currency-wallet-cleaners'
import { SwapSettings } from './account-types'

// ---------------------------------------------------------------------
// building-block types
// ---------------------------------------------------------------------

const asEdgeDenomination = asObject<EdgeDenomination>({
  multiplier: asString,
  name: asString,
  symbol: asOptional(asString)
})

const asEdgeToken = asObject<EdgeToken>({
  currencyCode: asString,
  denominations: asArray(asEdgeDenomination),
  displayName: asString,
  networkLocation: asOptional(asJsonObject)
})

const asSwapSettings = asObject<SwapSettings>({
  enabled: asOptional(asBoolean, true)
}).withRest

// ---------------------------------------------------------------------
// file types
// ---------------------------------------------------------------------

/**
 * An Airbitz Bitcoin wallet, which includes the private key & state.
 */
export const asLegacyWalletFile = asObject({
  SortIndex: asOptional(asNumber, 0),
  Archived: asOptional(asBoolean, false),
  BitcoinSeed: asBase16,
  MK: asBase16,
  SyncKey: asBase16
}).withRest

/**
 * An Edge wallet state file. The keys are stored in the login server.
 */
export const asWalletStateFile = asObject({
  id: asString,
  archived: asOptional(asBoolean),
  deleted: asOptional(asBoolean),
  hidden: asOptional(asBoolean),
  migratedFromWalletId: asOptional(asString),
  sortIndex: asOptional(asNumber)
})

/**
 * Stores settings for currency and swap plugins.
 */
export const asPluginSettingsFile = asObject({
  // Currency plugins:
  userSettings: asOptional(asObject(asJsonObject), () => ({})),

  // Swap plugins:
  swapSettings: asOptional(asObject(asSwapSettings), () => ({}))
}).withRest

/**
 * The settings file managed by the GUI.
 */
export const asGuiSettingsFile = asObject({
  customTokens: asArray(
    asObject({
      contractAddress: asString,
      currencyCode: asString,
      currencyName: asString,
      denomination: asString,
      denominations: asArray(asEdgeDenomination),
      isVisible: asOptional(asBoolean, true),
      multiplier: asString,
      walletType: asOptional(asString, 'wallet:ethereum')
    })
  )
})

export const asCustomTokensFile = asObject({
  customTokens: asObject(asObject(asEdgeToken))
})

/**
 * Cached account boot state, stored on the account's local disklet.
 * This is what the deferred account file loads would produce,
 * so wallet pixies can start before the account repo syncs.
 * Values are last-known and explicitly allowed to be stale;
 * the authoritative loads overwrite them within seconds.
 * Never contains private key material: wallet keys stay in the
 * encrypted login stash, which is already in memory at login.
 * Plugin settings are deliberately excluded: unlike wallet states
 * and token definitions, they can hold credentials (custom node
 * auth, API keys), which must never leave the encrypted repo.
 */
export interface AccountCacheFile {
  version: 2
  customTokens: EdgePluginMap<EdgeTokenMap>
  /**
   * True when the account has legacy Airbitz-repo wallets. Their
   * wallet infos cannot be cached (they contain private keys), so
   * such accounts boot cold rather than briefly hiding wallets.
   */
  legacyWallets: boolean
  walletStates: EdgeWalletStates
  /**
   * Each plugin's `otherMethods` names, so `CurrencyConfig` can
   * expose delegating stubs even if the plugin has not loaded yet.
   */
  configOtherMethodNames: EdgePluginMap<string[]>

  /**
   * Every active wallet's cached boot state, keyed by wallet id.
   * This absorbs what used to live in each wallet's own
   * `publicKey.json` + `walletCache.json` pair, so a warm boot reads
   * one file for the whole account instead of two per wallet.
   */
  wallets: { [walletId: string]: AccountCacheWallet }

  /**
   * Increases on every write. Two slots hold alternating generations,
   * so the reader can take the newest one that still parses; see
   * `loadAccountCache`.
   */
  sequence: number
}

/**
 * One wallet's cached boot state inside the account cache file:
 * the public keys that were in `publicKey.json` plus the UI state
 * that was in `walletCache.json`.
 */
export interface AccountCacheWallet {
  walletInfo: { id: string; keys: object; type: string }
  name: string | null
  fiatCurrencyCode: string
  enabledTokenIds: string[]

  /** Integer strings. The `null` tokenId is spelled '' here. */
  balances: { [tokenId: string]: string }

  /** Per tokenId, without balances (`null` tokenId spelled ''). */
  addresses: {
    [tokenIdKey: string]: Array<{ addressType: string; publicAddress: string }>
  }

  otherMethodNames: string[]
}

const asEdgeWalletState = asObject<EdgeWalletState>({
  archived: asOptional(asBoolean),
  deleted: asOptional(asBoolean),
  hidden: asOptional(asBoolean),
  migratedFromWalletId: asOptional(asString),
  sortIndex: asOptional(asNumber)
})

const asCachedAddress = asObject({
  addressType: asString,
  publicAddress: asString
})

const asAccountCacheWallet = asObject<AccountCacheWallet>({
  walletInfo: asObject({
    id: asString,
    keys: asJsonObject,
    type: asString
  }),
  name: asEither(asString, asNull),
  fiatCurrencyCode: asString,
  enabledTokenIds: asArray(asString),
  balances: asObject(asIntegerString),
  addresses: asObject(asArray(asCachedAddress)),
  otherMethodNames: asArray(asString)
})

export const asAccountCacheFile: Cleaner<AccountCacheFile> = asObject({
  version: asValue(2),
  sequence: asNumber,
  customTokens: asObject(asObject(asEdgeToken)),
  legacyWallets: asOptional(asBoolean, false),
  walletStates: asObject(asEdgeWalletState),
  configOtherMethodNames: asOptional(asObject(asArray(asString)), () => ({})),
  wallets: asObject(asAccountCacheWallet)
})

const asAccountCacheFileV1 = asObject({
  version: asValue(1),
  customTokens: asObject(asObject(asEdgeToken)),
  legacyWallets: asOptional(asBoolean, false),
  walletStates: asObject(asEdgeWalletState),
  configOtherMethodNames: asOptional(asObject(asArray(asString)), () => ({}))
})

/**
 * Read-side cleaner: upgrades a version-1 file instead of falling
 * through to a cold boot. A version-1 file predates the consolidated
 * wallet table, so its wallets are still in their own per-wallet
 * files, which `bulkLoadWalletCaches` reads once before this file is
 * rewritten in the current schema. Writes always use
 * `asAccountCacheFile`.
 */
export const asStoredAccountCacheFile: Cleaner<AccountCacheFile> = raw => {
  try {
    return asAccountCacheFile(raw)
  } catch (error: unknown) {
    const clean = asAccountCacheFileV1(raw)
    return { ...clean, version: 2, sequence: 0, wallets: {} }
  }
}

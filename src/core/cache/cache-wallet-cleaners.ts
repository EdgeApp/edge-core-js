import {
  asArray,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue
} from 'cleaners'

import { asEdgeToken } from '../account/account-cleaners'

// ----------------------------------------------------------------
// Shared constants used across cache modules
// ----------------------------------------------------------------

/** Key used in balances map for the parent currency (null tokenId) */
export const PARENT_CURRENCY_KEY = 'null'

/** Number of characters to show when logging wallet IDs */
export const WALLET_ID_DISPLAY_LENGTH = 8

// ----------------------------------------------------------------
// Cleaners
// ----------------------------------------------------------------

/**
 * Cleaner for validating cached wallet data from disk.
 * Each cached wallet contains essential state for instant UI display.
 */
export const asCachedWallet = asObject({
  id: asString,
  type: asString,
  name: asOptional(asString),
  pluginId: asString,
  fiatCurrencyCode: asString,
  // tokenId (or "null" for parent currency) -> nativeAmount
  balances: asObject(asString),
  enabledTokenIds: asArray(asString),
  // Method names from otherMethods for delegation
  otherMethodNames: asArray(asString),
  // Creation date (ISO string)
  created: asString,
  // Public wallet info (safe - no private keys).
  // keys uses asUnknown to match JsonObject (plugins may store non-string values)
  publicWalletInfo: asObject({
    id: asString,
    type: asString,
    keys: asObject(asUnknown)
  })
})

/**
 * Cleaner for validating the wallet cache file structure from disk.
 * The file contains token definitions and wallet state for all cached wallets.
 */
export const asWalletCacheFile = asObject({
  version: asValue(1),
  // pluginId -> tokenId -> token
  tokens: asObject(asObject(asEdgeToken)),
  wallets: asArray(asCachedWallet),
  // Config otherMethods names per plugin
  configOtherMethodNames: asObject(asArray(asString))
})

/** Cached wallet data structure, validated by asCachedWallet cleaner */
export type CachedWallet = ReturnType<typeof asCachedWallet>

/** Wallet cache file structure, validated by asWalletCacheFile cleaner */
export type WalletCacheFile = ReturnType<typeof asWalletCacheFile>

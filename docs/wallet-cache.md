# Wallet Cache

## Overview

A wallet caching system for edge-core-js that improves login performance by loading cached wallet data instead of instantiating currency plugins.

## Features

- Caches wallet metadata: name, currency type, balances, enabled tokens
- Read-only wallets with stubbed methods
- All `EdgeCurrencyWallet` methods present but stubbed
- Method calls logged to console for debugging
- Works with existing accounts

## API

### Enabling Cache Mode

```typescript
const context = await makeEdgeContext({
  appId: 'com.example.app',
  walletCacheEnabled: true
})
```

When enabled, the core automatically loads the cache for the account being logged in from:
`accountCache/[accountId]/walletCache.json`

### Saving a Cache

```typescript
// After logging in normally:
const account = await context.loginWithPassword(username, password)
await account.waitForAllWallets()

// Save the cache
await account.saveWalletCache()
```

## Cache File Format

```typescript
const asWalletCacheFile = asObject({
  version: asValue(1),
  tokens: asMap(asMap(asCachedToken)), // pluginId -> tokenId -> token
  wallets: asArray(asCachedWallet)
})

const asCachedWallet = asObject({
  id: asString,
  type: asString,
  name: asOptional(asString),
  pluginId: asString,
  fiatCurrencyCode: asString,
  balances: asMap(asString), // tokenId (or "null") -> nativeAmount
  enabledTokenIds: asArray(asString),
  customTokens: asMap(asCachedToken)
})

const asCachedToken = asObject({
  currencyCode: asString,
  displayName: asString,
  denominations: asArray(asCachedDenomination),
  networkLocation: asOptional(asObject({}))
})
```

## Stubbed Behavior

| Operation | Behavior |
|-----------|----------|
| Read (balances, name, etc.) | Returns cached data |
| Write (rename, settings) | No-op, logs call |
| Transactions (sign, broadcast) | Throws error |
| Sync | No-op |

## Implementation

- `src/core/cache/cache-wallet-cleaners.ts` - Cache file schema definitions
- `src/core/cache/cache-wallet-loader.ts` - Cache loading logic
- `src/core/cache/cached-currency-wallet.ts` - Cached wallet implementation
- `src/core/cache/cached-currency-config.ts` - Cached config implementation
- `src/core/account/account-api.ts` - `saveWalletCache()` method
- `src/core/account/account-pixie.ts` - Cache initialization flow

## Implementation Status

### edge-core-js (Complete)

- [x] Changed `walletCachePath` to `walletCacheEnabled: boolean` in `EdgeContextOptions`
- [x] Auto-detect cache path based on account ID after login
- [x] Load cache from `accountCache/[accountId]/walletCache.json`

Files modified:
- `src/types/types.ts` - Added `walletCacheEnabled` to `EdgeContextOptions`
- `src/core/actions.ts` - Updated INIT action payload
- `src/core/root-reducer.ts` - Updated RootState and reducer
- `src/core/root.ts` - Updated makeContext
- `src/core/account/account-pixie.ts` - Auto-detect cache path from account ID

### edge-react-gui (Complete)

- [x] Added `walletCacheEnabled` to `DeviceSettings` type
- [x] Added `writeWalletCacheEnabled()` action
- [x] Added "Enable Wallet Cache" toggle in Developer Mode settings
- [x] Added "Save Wallet Cache" button in Developer Mode settings
- [x] Pass `walletCacheEnabled` when creating EdgeContext

Files modified:
- `src/types/types.ts` - Added `walletCacheEnabled` to `asDeviceSettingsInner`
- `src/actions/DeviceSettingsActions.ts` - Added `writeWalletCacheEnabled()`
- `src/components/scenes/SettingsScene.tsx` - Added UI components
- `src/components/services/EdgeCoreManager.tsx` - Pass `walletCacheEnabled` to context

**Note:** edge-react-gui changes require the updated edge-core-js to be published first.

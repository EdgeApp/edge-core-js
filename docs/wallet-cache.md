# Wallet Cache Architecture

Wallet caching provides instant UI on login by saving wallet state to an unencrypted JSON file and restoring it before currency engines load.

## Overview

On login, the account pixie checks for a cache file at `accountCache/<storageWalletId>/walletCache.json`. If found, it creates lightweight cached wallet objects that the GUI can display immediately. Real wallets load in the background and replace/supplement the cached ones.

The cache file contains:

- Token definitions (only tokens enabled by at least one wallet)
- Wallet state: id, type, name, pluginId, fiatCurrencyCode, balances, enabledTokenIds, otherMethodNames, created date, publicWalletInfo
- Config otherMethods names per plugin

## Cached Wallet Delegation

Cached wallets implement the full `EdgeCurrencyWallet` interface. Property getters return cached values as defaults, delegating to the real wallet when available via `tryGetRealWallet()`. Async methods delegate via a shared `delegate()` helper that checks for the real wallet synchronously first, then waits via a shared polling promise.

Key design constraint: the cached wallet runs inside the WebView (edge-core-js), while the GUI reads properties through the yaob bridge. yaob caches getter values on the client side and only refreshes them when `update(object)` is called. Since no pixie calls `update()` on cached wallets, **any setter that changes a value the GUI reads back must call `update(wallet)` after mutation** to propagate through yaob. Four setters require this:

- `changePaused` / `paused`
- `renameWallet` / `name`
- `setFiatCurrencyCode` / `fiatCurrencyCode`
- `changeEnabledTokenIds` / `enabledTokenIds`

Each setter: (1) awaits the delegate to the real wallet, (2) updates a local variable, (3) calls `update(wallet)`. If the delegate throws, no local state changes.

## Shared Polling (`makeRealObjectPoller`)

Both cached wallets and cached configs use `makeRealObjectPoller<T>` from `cache-utils.ts`. This creates a single shared promise per object -- all callers that need the real wallet share the same 300ms poll loop. This avoids N concurrent polling loops when N methods are called simultaneously. The poller times out after 60 seconds.

## otherMethods Delegation

Plugin `otherMethods` are cached by name in the cache file. `createDelegatingOtherMethods` creates stub functions for each cached name. When called, each stub checks if the real otherMethods are available synchronously, otherwise waits for the real wallet/config. Method names not in the cache return `undefined` until the real object loads. Wallet otherMethods are bridgified for yaob serialization.

## Disklet Delegation

Cached wallets expose delegating disklets that forward all operations (`getText`, `setText`, `getData`, `setData`, `list`, `delete`) to the real wallet's disklet. During the cache phase, operations wait for the real wallet. The GUI does not access wallet-level disklets during the cache window -- account-level disklets (for settings, referrals) come from the account's own storage wallet, not currency wallets.

## Cache Saving

`makeWalletCacheSaver` implements a dirty-triggered throttle. The account pixie's `cacheSaver` sub-pixie detects wallet state changes reactively in its `update()` method (triggered by Redux state changes) and calls `markDirty()`. The saver responds immediately or schedules a delayed save:

- When `markDirty()` is called and >= throttleMs has elapsed since the last save, the save happens immediately.
- When `markDirty()` is called within the throttle window, the save is scheduled for when the window expires.
- Only one pending save is scheduled at a time; additional `markDirty()` calls during the window are coalesced.
- If changes arrive during an active save, another save is scheduled after completion.

Other features:

- Max 3 consecutive failures before giving up (prevents infinite log spam)
- Uses `account.loggedIn` to guard against writing after logout
- Only caches tokens enabled by at least one wallet (avoids caching thousands of Ethereum tokens)
- `walletCacheSaverConfig.throttleMs` can be overridden to 50ms in tests

## Cache Loading

`loadWalletCache` parses the JSON, validates through cleaners (`asWalletCacheFile`), creates one `EdgeCurrencyConfig` per plugin and one `EdgeCurrencyWallet` per cached wallet. Each gets a real-object lookup callback that reads from the pixie output. The loader also accepts `pauseWallets` from the login options so cached wallets match the real wallet's initial paused state.

Cache loading happens before `loadAllFiles` / `ACCOUNT_KEYS_LOADED`. If the cache file doesn't exist or fails validation (expected on first login or after schema changes), login falls through to the normal flow.

## paused State and WalletLifecycle

The GUI's `WalletLifecycle` boots wallets in batches by checking `wallet.paused`. Cached wallets start with `paused = pauseWallets` (true when the GUI passes `pauseWallets: true`). When WalletLifecycle calls `changePaused(false)`, the cached wallet delegates to the real wallet and calls `update(wallet)` to propagate the change through yaob. Without the `update()` call, yaob's client-side proxy would cache the old `paused = true` indefinitely, causing WalletLifecycle to re-boot the same wallets in an infinite loop.

## Testing

Tests use two mechanisms for deterministic control:

- **Engine gate**: `createEngineGate()` returns `{ gate, release }`. Setting `fakePluginTestConfig.engineGate = gate` blocks engine creation. Call `release()` to allow engines to load. This replaces timing-based delays with explicit control.
- **Cache saver throttle**: `walletCacheSaverConfig.throttleMs = 50` reduces the save interval from 5 seconds to 50ms in tests. Cache save waits use `await snooze(100)` (2x the throttle).

The fake currency plugin supports `fakePluginTestConfig.noOtherMethods = true` to test the empty-otherMethods code path.

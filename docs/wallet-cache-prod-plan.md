# Wallet Cache Production Plan

## Goal

Make the wallet cache fully production-capable with lazy engine instantiation. Users should be able to log in and see their wallets (with balances, names, etc.) without any calls to `makeCurrencyEngine`. Engines should only be instantiated when the GUI actually needs to interact with a wallet.

## Requirements

1. **Default behavior (no settings)**: Wallet caching is enabled by default with no configuration required. Remove the `walletCacheEnabled` setting.

2. **Auto-save cache (throttled)**: When any cached values change (balances, name, tokens, etc.), write the cache to disk. Throttle writes to at most once every 5 seconds.

3. **Load cached wallets on login**: Already implemented in current version.

4. **Lazy engine instantiation**: Do NOT call `makeCurrencyEngine` until the GUI calls a method that requires the engine (e.g., `getFreshAddress`, `signTx`, `broadcastTx`).

5. **Transparent engine replacement**: When a method requiring the engine is called:
   - Call `makeCurrencyEngine` and `startEngine` on the real plugin
   - Pass through to the real engine method
   - Mutate the cached wallet object in-place with real capabilities

6. **Address caching for subscriptions**: The core subscribes to addresses via the change service. These addresses must be available without calling `makeCurrencyEngine`.

## Address Subscription Analysis

**Current behavior:**
- Subscribed addresses are stored per-wallet in `seenTxCheckpoint.json` (along with the seen transaction checkpoint)
- Addresses are loaded during wallet initialization and passed to `makeCurrencyEngine`
- Change service reads subscriptions from Redux state (`currency.wallets[walletId].changeServiceSubscriptions`)
- The change service connects and subscribes when wallets have non-avoiding subscriptions

**Problem:** With lazy engine instantiation, the change service cannot subscribe to addresses until the engine is started, because the addresses are only loaded from disk during full wallet initialization.

**Solution:** Include subscribed addresses in the account-level wallet cache so they are available immediately on login.

## Implementation Steps

#### Step 1: Remove `walletCacheEnabled` setting

- Remove `walletCacheEnabled` from `EdgeContextOptions` type definition
- Remove any conditional logic that checks this setting
- Wallet caching is now always enabled by default

#### Step 2: Cache subscribed addresses and enable immediate change server subscription

Add subscribed addresses and checkpoint data to the wallet cache file, and subscribe to the change server immediately on login without calling `makeCurrencyEngine`.

**Schema changes** (`cache-wallet-cleaners.ts`):
```typescript
export const asCachedSubscribedAddress = asObject({
  address: asString,
  checkpoint: asOptional(asString)
})

export const asCachedWallet = asObject({
  // ... existing fields ...
  subscribedAddresses: asOptional(asArray(asCachedSubscribedAddress)),
  seenTxCheckpoint: asOptional(asString)
})
```

**Save** (`account-api.ts` in `saveWalletCache`):
- Read subscriptions from Redux state: `ai.props.state.currency.wallets[walletId].changeServiceSubscriptions`
- Filter out `'avoiding'` subscriptions
- Include `address` and `checkpoint` for each subscription
- Include `seenTxCheckpoint` from wallet state

**Load** (`cache-wallet-loader.ts`):
- Return `walletSubscriptions` array with addresses and checkpoints for each wallet
- In `account-pixie.ts`, dispatch `CURRENCY_WALLET_LOADED_SUBSCRIBED_ADDRESSES` action for each wallet
- This populates Redux state so the change service can subscribe immediately

**Change server subscription on login:**
- On cache load, immediately subscribe cached addresses (with checkpoints) to the change server
- No engine is created at this point — just listening for changes
- The change service manager (`currency-pixie.ts`) already reads from Redux state, so cached subscriptions will be picked up automatically

**On change detected:**
- When the change server sends an update for a subscribed address:
  1. Immediately call `makeCurrencyEngine()` for that wallet
  2. Call `startEngine()` to begin sync
  3. Forward the change notification to the engine via `syncNetwork()`
- This ensures engines are only created when there's actual activity to process

**Note:** The wallet state in Redux (`currency.wallets[walletId]`) must exist for the subscriptions to be stored. Initialize all wallet state for cached wallets during cache loading.

**Fallback for unsupported/unavailable change server:**
- For assets not supported by the change server, or when the change server is unavailable, call `makeCurrencyEngine()` and `startEngine()` immediately
- The cache still works regardless of change server availability — it provides instant UI while engines start in the background

#### Step 3: Auto-save cache with throttling

- Add file watcher/observer pattern for cached values
- Implement 5-second throttle (at most one write per 5 seconds)
- Save cache automatically when values change
- Files: `src/core/cache/cache-wallet-saver.ts` (new)

#### Step 4: Lazy engine instantiation

- Modify `currency-wallet-pixie.ts` to delay `makeCurrencyEngine` call
- Cached wallet methods that need engine should trigger instantiation
- Track which wallets have real engines vs cached-only

#### Step 5: Engine method passthrough with lazy instantiation

- When a cached wallet method is called that needs the engine:
  1. Await `makeEngine` (use promise lock to prevent duplicate calls)
  2. Trigger `startEngine` (fire-and-forget, don't block)
  3. Call the real engine method
  4. Return the real result
- Store engine reference for subsequent calls

#### Step 6: In-place wallet mutation

- Mutate the cached wallet object in-place as methods become available
- No need to replace references - the same object gains real capabilities
- GUI components holding wallet references continue to work seamlessly

## Wallet Methods and Cached Values

The cached wallet exposes the same `EdgeCurrencyWallet` interface. Most read-only properties are Yaob-bridged values that can be served directly from the cache.

### Static Read-Only Properties (always cached)

These properties are available immediately from the cache without engine initialization:

- `id`
- `name`
- `created`
- `type`
- `currencyConfig`
- `currencyInfo`
- `balanceMap`
- `balances`
- `blockHeight`
- `syncRatio` — Initializes to the lowest ratio that would have been reported prior to lazy instantiation (typically the value after `makeCurrencyEngine` but before `startEngine` completes)

### Wallet Methods

| Method | Behavior | Notes |
|--------|----------|-------|
| `getNumTransactions()` | Cache first | Return cached count; if cache empty, trigger engine start |
| `getAddresses()` | Cache first | Return cached addresses; if cache empty, trigger engine start |
| `getTransactions()` | Engine required | Triggers engine start |
| `streamTransactions()` | Engine required | Triggers engine start |
| `getFreshAddress()` | Engine required | Triggers engine start |
| `makeSpend()` | Engine required | Triggers engine start |
| `signTx()` | Engine required | Triggers engine start |
| `broadcastTx()` | Engine required | Triggers engine start |
| `saveTx()` | Engine required | Triggers engine start |
| `startEngine()` | Engine required | Explicit engine start |
| `stopEngine()` | No-op if not started | Safe to call on cached-only wallets |
| `changePaused()` | Engine required | Triggers engine start |
| `resyncBlockchain()` | Engine required | Triggers engine start |
| `getMaxSpendable()` | Engine required | Triggers engine start |
| `sweepPrivateKeys()` | Engine required | Triggers engine start |
| `signBytes()` | Engine required | Triggers engine start |
| `accelerate()` | Engine required | Triggers engine start |
| `saveTxMetadata()` | Engine required | Needs transaction from plugin |

### Methods That Work Without Engine

These methods can operate on cached/local data without engine initialization:

| Method | Notes |
|--------|-------|
| `renameWallet()` | Updates local wallet name |
| `setFiatCurrencyCode()` | Updates local fiat preference |
| `changeEnabledTokenIds()` | Updates local token settings |
| `encodeUri()` | Uses currencyInfo from plugin |
| `parseUri()` | Uses currencyInfo from plugin |

### Watch Methods

Watch methods (`watch('balance', ...)`, etc.) fire immediately with cached values when subscribed. As the engine syncs and updates values, watch callbacks fire again with updated data. This provides instant UI feedback while real data loads in the background.

## Design Decisions

1. **Wallet reference replacement**: Mutate the cached wallet object in-place. This preserves GUI references and avoids stale pointers.

2. **Engine startup blocking**:
   - All engine method calls **block on `makeEngine`** (must complete before method can execute)
   - All engine method calls **trigger `startEngine` but do NOT block on it** (sync happens in background)
   - This allows methods like `getFreshAddress` to return quickly once the engine is created, without waiting for full sync

3. **Error handling**: If engine instantiation fails, keep showing cached data. Log the error but don't disrupt the user experience.

4. **Concurrent calls**: Use a promise-based lock pattern. The first call to any engine-requiring method creates a shared promise for `makeEngine`. All concurrent calls await that same promise, ensuring `makeEngine` is only called once per wallet.

5. **Cache invalidation**: The cache is never invalidated. It always reflects the last-known state of each wallet. When engines start, they update the cache with fresh data, which is then persisted via the auto-save mechanism.

6. **Load order**: All cached wallets must be fully loaded (as proxy/cached wallet objects) before `makeCurrencyEngine` or `startEngine` is called on any of them. This ensures the GUI has access to all wallet references immediately on login, and prevents race conditions during initialization.

```typescript
// Pseudocode for lazy engine pattern
class CachedWallet {
  private enginePromise: Promise<EdgeCurrencyEngine> | undefined

  private async ensureEngine(): Promise<EdgeCurrencyEngine> {
    if (this.enginePromise == null) {
      this.enginePromise = this.createEngine()
    }
    return this.enginePromise
  }

  private async createEngine(): Promise<EdgeCurrencyEngine> {
    const engine = await plugin.makeCurrencyEngine(...)
    // Trigger startEngine but don't await it
    engine.startEngine().catch(err => log.error(err))
    return engine
  }

  async getFreshAddress(): Promise<EdgeFreshAddress> {
    const engine = await this.ensureEngine()
    return engine.getFreshAddress()
  }
}
```

## Testing Strategy

Use the Edge CLI repository (`edge-cli`) to test changes:

1. Link the modified `edge-core-js` using `npm link`
2. Use CLI commands to log in with a test account
3. Add debug logs to track which engines are started and when
4. Verify that:
   - Cached wallets appear immediately on login
   - Engines are only instantiated when engine-requiring methods are called
   - Change server subscriptions work with cached addresses

Each currency plugin may have otherMethods. Evaluate this idea. When creating the cache, look for the other methods object and find the functions existing in them and write those out as function names in the cache. Then when the cache is read, create those functions as stubs just like other functions like make spend. When the other methods are called, immediately make the engine and start the engines and then pass through the function call like all the other stubs would

Part of the wallet object are disclit objects with methods. For these objects, do not utilize a cache and initialize the disclit objects as they would normally be initialized for an uncached wallet.

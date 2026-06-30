# Change-server engine contract

This document explains the current contract between `edge-core-js` and
currency engines that integrate with the change-server.

Today, this contract is implemented by a combination of:

- Engine constructor options passed by the core
- Engine callbacks invoked by the engine
- `syncNetwork()` calls made by the core
- The websocket RPC protocol used by the change-server

At the time of writing, the only engine that actively implements this flow is
`EthereumEngine` in `edge-currency-accountbased`. Other engines may already use
the `seenTxCheckpoint` state for their own sync logic, but they do not yet
participate in the full change-server protocol described here.

## Purpose

The change-server exists to reduce polling and allow the core to wake an engine
when a subscribed address appears to have changed.

The split of responsibilities is:

- The core owns persistence, websocket connectivity, subscription state, and
  fallback behavior.
- The engine owns address selection, chain-specific sync logic, and checkpoint
  generation.

In practice, the protocol is:

1. Core restores prior change-server state and passes it into the engine.
2. Engine tells core which addresses should be watched.
3. Core subscribes those addresses to the change-server.
4. Core calls `syncNetwork()` when the change-server reports activity.
5. Engine updates and emits its latest transaction checkpoint back to core.

## Engine requirements

An engine participates in the change-server flow if all of the following are
true:

- Its `currencyInfo` sets `usesChangeServer: true`.
- It implements `syncNetwork(opts)`.
- It can accept `seenTxCheckpoint` and `subscribedAddresses` in
  `EdgeCurrencyEngineOptions`.
- It can call `onSubscribeAddresses(...)` and `onSeenTxCheckpoint(...)`.

If an engine does not meet those requirements, the core falls back to ordinary
periodic polling.

## Data types

The important shared types are:

```ts
interface EdgeSubscribedAddress {
  address: string
  checkpoint?: string
}
```

```ts
interface EdgeEngineSyncNetworkOptions {
  subscribeParam?: {
    address: string
    checkpoint?: string
    needsSync?: boolean
  }
  privateKeys?: JsonObject
}
```

These values are intentionally generic:

- `address` is whatever address or account identifier the engine wants the
  change-server to watch.
- `checkpoint` is a chain-specific progress marker. For EVM chains this is
  currently treated as a block height string.
- `needsSync` tells the engine whether the core believes it must perform a real
  sync now. If omitted, engines should treat it as `true`.

## Core to engine: startup contract

Before creating a currency engine, the core loads persisted change-server state
from disk:

- The wallet's global `seenTxCheckpoint`
- The wallet's previously subscribed addresses

The core then passes this state into `makeCurrencyEngine(...)` through
`EdgeCurrencyEngineOptions`:

- `seenTxCheckpoint?: string`
- `subscribedAddresses?: EdgeSubscribedAddress[]`

The engine should treat these values as previously-known runtime state that it
may resume from on startup.

For `seenTxCheckpoint`, the intended meaning is more specific than "resume
state". It is the wallet's official new-transaction checkpoint, stored by the
core in synced storage so other devices can reuse the same boundary. Engines use
this checkpoint to decide whether a transaction received from the network should
be treated as new, which in turn controls `isNew` transaction events and
in-app notifications.

This checkpoint is not just a change-server implementation detail. The
change-server reuses it because it is already the core's cross-device boundary
for "transactions the user has already seen" versus "transactions that are
new".

### Expected engine behavior on startup

On startup, an engine that uses the change-server should:

1. Restore its in-memory checkpoint state from `seenTxCheckpoint`.
2. Restore or reuse `subscribedAddresses` if present.
3. Ensure the real wallet address is included.
4. Add any decoy or auxiliary addresses it wants watched.
5. Call `onSubscribeAddresses(...)` with the full current set of addresses to
   watch.

The address list sent to the core should be the engine's desired current set,
including checkpoints where available.

## Engine to core: callbacks

### `onSubscribeAddresses(addresses)`

This callback tells the core which addresses should be subscribed on the
change-server.

The engine should pass an array of `EdgeSubscribedAddress` objects:

```ts
onSubscribeAddresses([
  { address: '0xabc...', checkpoint: '12345' },
  { address: '0xdef...' }
])
```

Core behavior:

- Persists the subscribed addresses to disk
- Converts each address into an internal subscription state entry
- Marks those entries as `subscribing`
- Causes the change-service manager to subscribe them on the websocket

Important notes:

- This callback is effectively additive and replace-by-address. There is
  currently no well-defined removal flow for addresses that should no longer be
  watched.
- Engines may call this again later if the address set changes.

### `onSeenTxCheckpoint(checkpoint)`

This callback tells the core the wallet's latest confirmed transaction
checkpoint.

Core behavior:

- Persists the checkpoint to synced wallet storage
- Feeds the checkpoint back into the engine on the next startup

Expected engine behavior:

- Treat the checkpoint as the cross-device boundary for deciding whether a
  network transaction is new.
- Update and emit the checkpoint only when the wallet has actually caught up
  enough that the checkpoint is safe to persist.
- Do not emit mid-initial-sync checkpoints if doing so would cause future
  startups to skip historical work or incorrectly suppress new-transaction
  notifications.

## Core to change-server: websocket protocol

The core opens a websocket to a configured change-server and uses JSON-RPC to
subscribe addresses.

Each subscribe tuple is:

```ts
type SubscribeParams = [
  pluginId: string,
  address: string,
  checkpoint?: string
]
```

The change-server responds to `subscribe(...)` with one result per address:

- `-1`: unsupported plugin
- `0`: subscription failed
- `1`: subscribed successfully and no changes were detected
- `2`: subscribed successfully and changes were detected

The change-server may later send:

- `update([pluginId, address, checkpoint])`
- `subLost([pluginId, address])`

## Core side state machine

For each subscribed address, the core tracks a subscription status:

- `subscribing`
- `subscribingSlowly`
- `synced`
- `syncing`
- `listening`
- `resubscribing`
- `reconnecting`
- `avoiding`

The high-level behavior is:

1. Engine calls `onSubscribeAddresses(...)`.
2. Core records the addresses as `subscribing`.
3. Core opens the websocket if at least one wallet has change-server support.
4. Core calls `subscribe(...)` on the change-server.
5. Core converts the results into wallet subscription states:
   - `-1` -> `avoiding`
   - `0` -> `resubscribing`
   - `1` -> `synced`
   - `2` -> `syncing`
6. Core calls `engine.syncNetwork(...)` for `synced` and `syncing` entries.
7. After the engine call completes, core moves those entries to `listening`.
8. Future `update(...)` messages move matching entries back to `syncing`.
9. Future `subLost(...)` messages move matching entries back to `subscribing`.
10. Socket disconnects move supported entries to `reconnecting`.

If the subscribe RPC is slow, the core will temporarily mark the wallet as
`subscribingSlowly` and fall back to ordinary polling until the subscription
flow settles.

## Core to engine: runtime `syncNetwork()` contract

The engine must support two `syncNetwork()` modes.

### Ordinary polling

When the core calls:

```ts
await engine.syncNetwork({})
```

or passes only `privateKeys`, this is ordinary periodic sync. The engine should
perform its normal network sync behavior and return the next polling delay.

### Change-server wakeup

When the core calls:

```ts
await engine.syncNetwork({
  subscribeParam: {
    address,
    checkpoint,
    needsSync
  }
})
```

this is a change-server-triggered wakeup.

Expected engine behavior:

1. Inspect `subscribeParam.address`.
2. Ignore the wakeup if the address is one the engine intentionally treats as a
   decoy or non-authoritative address.
3. If `needsSync === false`, the engine may perform a cheap no-op path and mark
   itself fully synced if appropriate.
4. If `needsSync !== false`, the engine should perform whatever network work is
   needed to catch up with the reported change.
5. Use `subscribeParam.checkpoint` as a chain-specific hint or target.
6. Return the next polling delay as usual.

### Meaning of `checkpoint`

The `checkpoint` value is chain-specific and should be interpreted as a hint
provided by the change-server. In the current EVM implementation, the engine
parses it as a block height and retries syncing until local history has reached
that height.

Engines should not assume the checkpoint is always present:

- Live activity may arrive without a checkpoint, such as mempool-like updates.
- A missing checkpoint means "something changed, but there is no authoritative
  height target".

For that reason, engines should treat checkpoint-less updates as best-effort
signals rather than strict synchronization targets.

## Fallback behavior

The core intentionally keeps periodic polling available alongside the
change-server.

Fallback cases include:

- The engine does not use the change-server
- The change-server does not support the plugin
- A subscribe call fails
- The websocket disconnects
- The subscribe call is taking too long

This means engines should continue to support ordinary `syncNetwork()` polling
even after integrating with the change-server.

## Current Ethereum behavior

`EthereumEngine` is the current reference implementation.

It does the following:

- Restores `subscribedAddresses` from core
- Ensures the real address is present
- Adds decoy addresses for privacy
- Calls `onSubscribeAddresses(...)` with the shuffled list
- Ignores wakeups for decoy addresses
- Treats `checkpoint` as a block height string
- Treats missing checkpoints as mempool-style updates and currently ignores
  them
- Emits `onSeenTxCheckpoint(...)` once sync state has safely advanced

Future engines should use that implementation as the closest working example,
while also treating this document as the intended contract.

## Limitations of the current contract

The current system works, but engine authors should be aware of these existing
limitations:

- The contract is spread across multiple files and is not enforced by a single
  explicit interface.
- Address removal is not fully defined.
- Subscription results are returned per address, but some core state updates are
  currently applied at wallet scope.
- The core accepts multiple `changeServer` URLs but currently connects only to
  the first configured server.
- Checkpoint semantics are intentionally loose and may differ by chain.

## Checklist for engine authors

When adding change-server support to a new engine:

1. Set `currencyInfo.usesChangeServer = true`.
2. Accept `seenTxCheckpoint` and `subscribedAddresses` in the engine
   constructor.
3. Track the wallet's best persisted checkpoint.
4. Call `onSubscribeAddresses(...)` with the addresses the engine wants watched.
5. Implement `syncNetwork({ subscribeParam })` for change-server wakeups.
6. Keep ordinary polling behavior working as a fallback.
7. Call `onSeenTxCheckpoint(...)` only when the new checkpoint is safe to save.
8. Handle missing checkpoints gracefully.
9. Handle reconnect, resubscribe, and duplicate wakeups idempotently.

This checklist describes the current expected behavior, not a long-term
stability guarantee. If the protocol changes, this document should be updated at
the same time as the implementation.

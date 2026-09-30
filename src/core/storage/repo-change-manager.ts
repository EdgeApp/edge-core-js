import { ApiInput } from '../root-pixie'
import { RootState } from '../root-reducer'
import { describeSyncError, syncKeyToRepoId } from './repo'
import { storageSyncConfig, syncRepoAndReload } from './storage-actions'
import { StorageWalletSubscriptionStatus } from './storage-reducer'
import {
  connectSyncServer,
  makeSyncHostPicker,
  SyncHostPicker,
  syncServerConfig,
  SyncServerConnection
} from './sync-server-connection'
import {
  SyncSubscribeParams,
  SyncSubscribeResult,
  SyncUpdateParams
} from './sync-server-protocol'

/** Most repos one `subscribeRepos` call may carry. */
export const SUBSCRIBE_BATCH_SIZE = 100

export type RepoChangeManagerOutput = undefined

interface SocketEntry {
  connection: SyncServerConnection

  /** Storage wallet ids assigned to this socket. */
  ids: Set<string>

  /** Pending `flush`, which sends the socket's unsubscribed repos. */
  flushTimer: ReturnType<typeof setTimeout> | undefined

  /** When the oldest repo still waiting for `flush` started waiting. */
  pendingSince: number | undefined

  /** How many repos were waiting when `flush` was last scheduled. */
  pendingCount: number

  /** Connection epoch the call history below belongs to. */
  epoch: number

  /** When each recent `subscribeRepos` call went out. */
  callTimes: number[]

  /** Failed calls in a row, for the retry backoff. */
  failures: number

  /** No calls before this time, while backing off. */
  notBefore: number
}

interface PullRun {
  /** Another request arrived while this pull was running. */
  again: boolean
}

/**
 * The newest checkpoint in a repo's `lastHash` ladder.
 * `lastHash` is written only after a completed sync,
 * so this is the last checkpoint the client actually holds.
 */
export function newestCheckpoint(
  lastHash: string | undefined
): string | undefined {
  if (lastHash == null) return
  const [head] = lastHash.split(',')
  return head === '' ? undefined : head
}

/**
 * The repos this context should watch, account repos first,
 * so the login-critical repo lands in the first batch.
 * A repo joins once it has synced at least once, so its
 * subscription always carries a checkpoint the client holds.
 */
export function listWatchedRepos(state: RootState): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const storageWallet = state.storageWallets[id]
    if (storageWallet == null || storageWallet.status.lastSync <= 0) return
    out.push(id)
  }
  for (const accountId of state.accountIds) {
    const account = state.accounts[accountId]
    if (account == null) continue
    for (const info of account.accountWalletInfos) add(info.id)
  }
  for (const walletId of state.currency.currencyWalletIds) add(walletId)
  return out
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms
    )
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Subscribes every storage repo to sync-server change notifications,
 * so repos only pull when the server reports a change.
 *
 * Correctness rests on the subscribe checkpoint coming from
 * `status.lastHash`, which only a completed sync writes. Nothing on
 * the notification path records the notified checkpoint, so a change
 * reported just before a crash is still reported as a change on the
 * next subscribe.
 */
export function repoChangeManager(input: ApiInput): {
  update: () => void
  destroy: () => void
} {
  const sockets: SocketEntry[] = []
  const repoIds = new Map<string, string>() // repoId -> storage wallet id
  const pulls = new Map<string, PullRun>()
  const pausedPulls = new Set<string>()
  const owedPullsStarted = new Set<string>()
  let hosts: SyncHostPicker | undefined
  let owedTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  let lastInputs: unknown[] = []
  let lastUrls: string[] | undefined
  let lastPaused = false

  function setStatuses(
    ids: string[],
    status: StorageWalletSubscriptionStatus,
    syncOwed?: boolean
  ): void {
    if (destroyed || ids.length === 0) return
    const subscriptions: {
      [id: string]: {
        status: StorageWalletSubscriptionStatus
        syncOwed?: boolean
      }
    } = {}
    for (const id of ids) subscriptions[id] = { status, syncOwed }
    input.props.dispatch({
      type: 'STORAGE_WALLETS_SUBSCRIPTIONS_CHANGED',
      payload: { subscriptions }
    })
  }

  function getStatus(id: string): StorageWalletSubscriptionStatus | undefined {
    return input.props.state.storageWallets[id]?.subscription.status
  }

  /**
   * Pulls a repo, coalescing requests that arrive mid-pull into one
   * follow-up pull. A failed pull puts the repo back on polling.
   */
  function pull(id: string): void {
    if (destroyed) return
    if (input.props.state.paused) {
      pausedPulls.add(id)
      return
    }
    const running = pulls.get(id)
    if (running != null) {
      running.again = true
      return
    }
    const run: PullRun = { again: false }
    pulls.set(id, run)
    if (getStatus(id) === 'listening') setStatuses([id], 'syncing')
    ;(async () => {
      let ok = true
      while (true) {
        run.again = false
        try {
          await syncRepoAndReload(input, id)
        } catch (error: unknown) {
          ok = false
          input.props.log.warn(
            `syncServer pull ${id} failed: ${describeSyncError(error)}`
          )
        }
        if (!run.again || !ok || destroyed) break
      }
      pulls.delete(id)

      const status = getStatus(id)
      if (!ok && (status === 'listening' || status === 'syncing')) {
        setStatuses([id], 'avoiding')
      } else if (status === 'syncing') {
        setStatuses([id], 'listening')
      }
    })().catch(() => {})
  }

  function handleUpdate(entry: SocketEntry, params: SyncUpdateParams[]): void {
    const { storageWallets } = input.props.state
    const ids = new Set<string>()
    for (const [repoId, checkpoint] of params) {
      const id = repoIds.get(repoId)
      if (id == null || !entry.ids.has(id)) continue
      const storageWallet = storageWallets[id]
      if (storageWallet == null) continue

      // Our own writes echo back, and we already hold those:
      if (newestCheckpoint(storageWallet.status.lastHash) === checkpoint) {
        continue
      }
      ids.add(id)
    }
    Array.from(ids).forEach(pull)
  }

  function handleSubLost(
    entry: SocketEntry,
    params: Array<[repoId: string]>
  ): void {
    const ids: string[] = []
    for (const [repoId] of params) {
      const id = repoIds.get(repoId)
      if (id != null && entry.ids.has(id)) ids.push(id)
    }
    // Back to polling, until `reconcile` resubscribes:
    setStatuses(ids, 'unsubscribed')
    reconcile()
  }

  function handleDisconnect(entry: SocketEntry): void {
    const ids = Array.from(entry.ids).filter(id => {
      const status = getStatus(id)
      return status != null && status !== 'unsubscribed'
    })
    setStatuses(ids, 'unsubscribed')
    reconcile()
  }

  /** The socket's repos waiting for a subscription, in watch order. */
  function listUnsubscribed(entry: SocketEntry): string[] {
    const { state } = input.props
    return listWatchedRepos(state).filter(
      id =>
        entry.ids.has(id) &&
        state.storageWallets[id].subscription.status === 'unsubscribed'
    )
  }

  function scheduleFlush(entry: SocketEntry, at: number): void {
    if (entry.flushTimer != null) clearTimeout(entry.flushTimer)
    entry.flushTimer = setTimeout(
      () => flush(entry),
      Math.max(0, at - Date.now())
    )
  }

  /**
   * Repos become subscribable one at a time as their first syncs
   * finish, so subscriptions wait for a short quiet spell (bounded by
   * a maximum wait) and go out together, rather than one call each.
   */
  function requestFlush(entry: SocketEntry): void {
    const count = listUnsubscribed(entry).length
    if (count === 0) return
    if (entry.flushTimer != null && count === entry.pendingCount) return
    entry.pendingCount = count

    const now = Date.now()
    if (entry.pendingSince == null) entry.pendingSince = now
    const { subscribeDebounceMs, subscribeMaxWaitMs } = syncServerConfig
    const at = Math.min(
      now + subscribeDebounceMs,
      entry.pendingSince + subscribeMaxWaitMs
    )
    scheduleFlush(entry, Math.max(at, entry.notBefore))
  }

  /**
   * Sends the socket's unsubscribed repos, 100 per call, account repos
   * first. Calls stay under the server's per-connection rate limit;
   * repos that do not fit wait for the next free slot.
   */
  function flush(entry: SocketEntry): void {
    entry.flushTimer = undefined
    const { connection } = entry
    if (destroyed || !connection.connected) {
      entry.pendingSince = undefined
      return
    }

    // The server counts calls per connection:
    if (entry.epoch !== connection.epoch) {
      entry.epoch = connection.epoch
      entry.callTimes = []
      entry.failures = 0
      entry.notBefore = 0
    }

    const now = Date.now()
    if (now < entry.notBefore) return scheduleFlush(entry, entry.notBefore)
    entry.callTimes = entry.callTimes.filter(time => now - time < 60 * 1000)

    const ids = listUnsubscribed(entry)
    entry.pendingSince = undefined
    entry.pendingCount = 0
    if (ids.length === 0) return

    const { subscribeCallsPerMinute } = syncServerConfig
    let slots = subscribeCallsPerMinute - entry.callTimes.length
    let i = 0
    for (; i < ids.length && slots > 0; i += SUBSCRIBE_BATCH_SIZE, --slots) {
      const batch = ids.slice(i, i + SUBSCRIBE_BATCH_SIZE)
      entry.callTimes.push(now)
      setStatuses(batch, 'subscribing')
      subscribe(entry, batch).catch(() => {})
    }
    if (i < ids.length) {
      entry.pendingSince = now
      scheduleFlush(entry, entry.callTimes[0] + 60 * 1000)
    }
  }

  /**
   * Subscribes one batch. A call that fails outright (rate limit,
   * error, timeout) puts its repos back in line after a backoff,
   * polling meanwhile, rather than giving up for the session.
   * Results from a socket that has since dropped are discarded,
   * since the drop already put those repos back on polling.
   */
  async function subscribe(entry: SocketEntry, batch: string[]): Promise<void> {
    const { connection } = entry
    const { epoch } = connection
    const { storageWallets } = input.props.state
    const params = batch.map((id): SyncSubscribeParams => {
      const storageWallet = storageWallets[id]
      const repoId = syncKeyToRepoId(storageWallet.paths.syncKey)
      const checkpoint = newestCheckpoint(storageWallet.status.lastHash)
      return checkpoint == null ? [repoId] : [repoId, checkpoint]
    })

    const results = await withTimeout(
      connection.subscribe(params),
      syncServerConfig.subscribeTimeoutMs
    ).catch((error: unknown): undefined => {
      input.props.log.warn(
        `syncServer subscribe failed: ${describeSyncError(error)}`
      )
      return undefined
    })
    if (destroyed || connection.epoch !== epoch || !connection.connected) {
      return
    }
    if (results == null) {
      retryLater(entry, batch)
      return
    }
    entry.failures = 0
    applyResults(entry, batch, results)
  }

  /**
   * Puts repos back in line after a backoff. They poll meanwhile,
   * and any owed first sync runs now.
   */
  function retryLater(entry: SocketEntry, batch: string[]): void {
    const { storageWallets } = input.props.state
    const ids = batch.filter(
      id => storageWallets[id]?.subscription.status === 'subscribing'
    )
    const { subscribeRetryBaseMs, subscribeRetryMaxMs } = syncServerConfig
    const delay = Math.min(
      subscribeRetryMaxMs,
      subscribeRetryBaseMs * 2 ** entry.failures++
    )
    entry.notBefore = Math.max(
      entry.notBefore,
      Date.now() + delay * (0.5 + Math.random() / 2)
    )
    setStatuses(ids, 'unsubscribed')
    for (const id of ids) {
      if (storageWallets[id].subscription.syncOwed) pull(id)
    }
    requestFlush(entry)
  }

  function applyResults(
    entry: SocketEntry,
    batch: string[],
    results: SyncSubscribeResult[]
  ): void {
    const { storageWallets } = input.props.state
    const listening: string[] = []
    const avoiding: string[] = []
    const retry: string[] = []
    const toPull: string[] = []
    for (let i = 0; i < batch.length; ++i) {
      const id = batch[i]
      const storageWallet = storageWallets[id]
      if (storageWallet == null || !entry.ids.has(id)) continue
      if (storageWallet.subscription.status !== 'subscribing') continue

      const result = results[i] ?? 0
      if (result === 1) {
        listening.push(id)
      } else if (result === 2) {
        listening.push(id)
        toPull.push(id)
      } else if (result === 0) {
        // The server could not check or had no room; try again later:
        retry.push(id)
      } else {
        avoiding.push(id)
        if (storageWallet.subscription.syncOwed) toPull.push(id)
      }
    }
    // Result 1 settles the owed first sync, since nothing changed:
    setStatuses(listening, 'listening', false)
    setStatuses(avoiding, 'avoiding')
    for (const id of toPull) pull(id)
    if (retry.length > 0) retryLater(entry, retry)
  }

  function makeSocket(): SocketEntry {
    const { log, makeSyncSocket, state } = input.props
    if (hosts == null) hosts = makeSyncHostPicker(state.syncWebSocketServers)
    if (makeSyncSocket == null) throw new Error('No WebSocket support')
    const entry: SocketEntry = {
      connection: undefined as any,
      ids: new Set(),
      flushTimer: undefined,
      pendingSince: undefined,
      pendingCount: 0,
      epoch: 0,
      callTimes: [],
      failures: 0,
      notBefore: 0
    }
    entry.connection = connectSyncServer({
      hosts,
      log,
      makeSocket: makeSyncSocket,
      callbacks: {
        handleConnect: () => reconcile(),
        // This can fire while the socket is still being built:
        handleConnectFailed: () => setTimeout(reconcile, 0),
        handleDisconnect: () => handleDisconnect(entry),
        handleSubLost: params => handleSubLost(entry, params),
        handleUpdate: params => handleUpdate(entry, params)
      }
    })
    return entry
  }

  /**
   * Repos loaded from disk skip their first sync, leaving it to the
   * subscription result. If no result arrives in time, sync anyway.
   * This only matters while a connect attempt is still in flight,
   * since a socket that is down releases owed syncs at once.
   */
  function armOwedTimer(watched: string[]): void {
    if (owedTimer != null) return
    const { storageWallets } = input.props.state
    if (!watched.some(id => storageWallets[id].subscription.syncOwed)) return
    owedTimer = setTimeout(() => {
      owedTimer = undefined
      if (destroyed) return
      const { storageWallets } = input.props.state
      for (const id of listWatchedRepos(input.props.state)) {
        if (storageWallets[id].subscription.syncOwed) pull(id)
      }
    }, syncServerConfig.subscribeTimeoutMs)
  }

  /**
   * Brings the sockets and subscriptions in line with the watched repos.
   */
  function reconcile(): void {
    if (destroyed) return
    const { makeSyncSocket, state } = input.props
    if (makeSyncSocket == null || state.syncWebSocketServers.length === 0) {
      return
    }
    // Follow the host list when REST's hosts change, moving any
    // socket whose host is no longer listed:
    if (lastUrls !== state.syncWebSocketServers) {
      lastUrls = state.syncWebSocketServers
      if (hosts != null) {
        hosts.update(lastUrls)
        for (const entry of sockets) {
          if (!lastUrls.includes(entry.connection.url)) {
            entry.connection.reconnect()
          }
        }
      }
    }

    const watched = listWatchedRepos(state)
    const watchedSet = new Set(watched)

    // Drop repos we no longer watch:
    for (const entry of sockets) {
      const dropped: string[] = []
      for (const id of Array.from(entry.ids)) {
        if (watchedSet.has(id)) continue
        entry.ids.delete(id)
        const repoId = findRepoId(id)
        if (repoId != null) {
          repoIds.delete(repoId)
          dropped.push(repoId)
        }
      }
      if (dropped.length > 0 && entry.connection.connected) {
        entry.connection.unsubscribe(dropped).catch(() => {})
      }
    }

    // Assign new repos, filling sockets in order:
    const assigned = new Set<string>()
    for (const entry of sockets) entry.ids.forEach(id => assigned.add(id))
    for (const id of watched) {
      if (assigned.has(id)) continue
      let entry = sockets.find(
        entry => entry.ids.size < storageSyncConfig.subscriptionsPerSocket
      )
      if (entry == null) {
        entry = makeSocket()
        sockets.push(entry)
      }
      entry.ids.add(id)
      repoIds.set(syncKeyToRepoId(state.storageWallets[id].paths.syncKey), id)
    }

    // Close empty sockets:
    for (let i = sockets.length - 1; i >= 0; --i) {
      if (sockets[i].ids.size > 0) continue
      closeSocket(sockets[i])
      sockets.splice(i, 1)
    }

    // Subscribe anything not yet subscribed on a live socket:
    for (const entry of sockets) {
      if (entry.connection.connected) requestFlush(entry)
    }

    // Owed first syncs only wait on a connect attempt in flight.
    // With the socket down between attempts, they run now:
    for (const entry of sockets) {
      const { connection } = entry
      if (connection.connected || connection.connecting) continue
      for (const id of watched) {
        if (!entry.ids.has(id) || owedPullsStarted.has(id)) continue
        if (!state.storageWallets[id].subscription.syncOwed) continue
        owedPullsStarted.add(id)
        pull(id)
      }
    }

    armOwedTimer(watched)
  }

  function closeSocket(entry: SocketEntry): void {
    if (entry.flushTimer != null) clearTimeout(entry.flushTimer)
    entry.flushTimer = undefined
    entry.connection.close()
  }

  function findRepoId(id: string): string | undefined {
    for (const [repoId, walletId] of Array.from(repoIds.entries())) {
      if (walletId === id) return repoId
    }
  }

  return {
    update() {
      const { state } = input.props

      // Returning to the foreground: the socket may have died while
      // the JS engine was frozen, so check it now rather than waiting
      // on a TCP timeout, and run any pulls that came in meanwhile:
      if (lastPaused && !state.paused) {
        for (const entry of sockets) entry.connection.checkLiveness()
        const ids = Array.from(pausedPulls)
        pausedPulls.clear()
        for (const id of ids) pull(id)
      }
      lastPaused = state.paused

      // Memoize on the state the watched list depends on:
      const inputs = [
        state.storageWallets,
        state.accountIds,
        state.accounts,
        state.currency.currencyWalletIds,
        state.syncWebSocketServers
      ]
      if (inputs.every((value, i) => value === lastInputs[i])) return
      lastInputs = inputs
      reconcile()
    },

    destroy() {
      destroyed = true
      if (owedTimer != null) clearTimeout(owedTimer)
      for (const entry of sockets) closeSocket(entry)
      sockets.splice(0, sockets.length)
    }
  }
}

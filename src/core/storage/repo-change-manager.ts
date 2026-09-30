import { ApiInput } from '../root-pixie'
import { RootState } from '../root-reducer'
import { syncKeyToRepoId } from './repo'
import { syncRepoAndReload } from './storage-actions'
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

/** Most repos one socket may hold. More repos open another socket. */
export const SUBSCRIPTIONS_PER_SOCKET = 200

export type RepoChangeManagerOutput = undefined

interface SocketEntry {
  connection: SyncServerConnection

  /** Storage wallet ids assigned to this socket. */
  ids: Set<string>
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
  let hosts: SyncHostPicker | undefined
  let owedTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  let lastInputs: unknown[] = []
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
          input.props.log.warn(`syncServer pull ${id} failed: ${String(error)}`)
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
  }

  /**
   * Subscribes repos in batches, in order, so the account repo
   * answers first. Results from a socket that has since dropped
   * are discarded, since the drop already put those repos back
   * on polling.
   */
  async function subscribe(entry: SocketEntry, ids: string[]): Promise<void> {
    const { connection } = entry
    const { epoch } = connection

    for (let i = 0; i < ids.length; i += SUBSCRIBE_BATCH_SIZE) {
      const batch = ids.slice(i, i + SUBSCRIBE_BATCH_SIZE)
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
      ).catch((error: unknown): SyncSubscribeResult[] => {
        input.props.log.warn(`syncServer subscribe failed: ${String(error)}`)
        return batch.map(() => 0)
      })
      if (destroyed || connection.epoch !== epoch || !connection.connected) {
        return
      }
      applyResults(entry, batch, results)
    }
  }

  function applyResults(
    entry: SocketEntry,
    batch: string[],
    results: SyncSubscribeResult[]
  ): void {
    const { storageWallets } = input.props.state
    const listening: string[] = []
    const avoiding: string[] = []
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
      } else {
        avoiding.push(id)
        if (storageWallet.subscription.syncOwed) toPull.push(id)
      }
    }
    // Result 1 settles the owed first sync, since nothing changed:
    setStatuses(listening, 'listening', false)
    setStatuses(avoiding, 'avoiding')
    for (const id of toPull) pull(id)
  }

  function makeSocket(): SocketEntry {
    const { log, makeSyncSocket, state } = input.props
    if (hosts == null) hosts = makeSyncHostPicker(state.syncWebSocketServers)
    if (makeSyncSocket == null) throw new Error('No WebSocket support')
    const entry: SocketEntry = {
      connection: undefined as any,
      ids: new Set()
    }
    entry.connection = connectSyncServer({
      hosts,
      log,
      makeSocket: makeSyncSocket,
      callbacks: {
        handleConnect: () => reconcile(),
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
        entry => entry.ids.size < SUBSCRIPTIONS_PER_SOCKET
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
      sockets[i].connection.close()
      sockets.splice(i, 1)
    }

    // Subscribe anything not yet subscribed on a live socket:
    for (const entry of sockets) {
      if (!entry.connection.connected) continue
      const ids = watched.filter(
        id =>
          entry.ids.has(id) &&
          state.storageWallets[id].subscription.status === 'unsubscribed'
      )
      if (ids.length === 0) continue
      setStatuses(ids, 'subscribing')
      subscribe(entry, ids).catch(() => {})
    }

    armOwedTimer(watched)
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
        state.currency.currencyWalletIds
      ]
      if (inputs.every((value, i) => value === lastInputs[i])) return
      lastInputs = inputs
      reconcile()
    },

    destroy() {
      destroyed = true
      if (owedTimer != null) clearTimeout(owedTimer)
      for (const entry of sockets) entry.connection.close()
      sockets.splice(0, sockets.length)
    }
  }
}

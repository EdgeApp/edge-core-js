import { bridgifyObject } from 'yaob'

import { EdgeWalletInfo } from '../../types/types'
import { makePeriodicTask } from '../../util/periodic-task'
import {
  loadAllWalletStates,
  reloadPluginSettings
} from '../account/account-files'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput } from '../root-pixie'
import { RootState } from '../root-reducer'
import {
  hasLocalChanges,
  loadRepoStatus,
  makeLocalDisklet,
  makeRepoPaths,
  syncRepo,
  watchRepoWrites
} from './repo'
import { StorageWalletStatus } from './storage-reducer'

export const SYNC_INTERVAL = 30 * 1000

/**
 * Repo polling intervals. Mutable so tests can shrink them,
 * following the `accountCacheSaverConfig` pattern.
 */
export const storageSyncConfig: {
  syncInterval: number

  /** Quiet time after a local write before uploading it. */
  uploadDebounceMs: number

  /** A failed upload retries after this, doubling each time. */
  uploadRetryBaseMs: number

  /** Upper bound on the upload retry delay. */
  uploadRetryMaxMs: number

  /**
   * Most repos one sync-server socket holds before another opens.
   * Matches the server's per-connection cap; lowered only in tests.
   */
  subscriptionsPerSocket: number
} = {
  syncInterval: SYNC_INTERVAL,
  uploadDebounceMs: 250,
  uploadRetryBaseMs: 1000,
  uploadRetryMaxMs: 60 * 1000,
  subscriptionsPerSocket: 200
}

/**
 * True if the sync server will report changes to every listed repo,
 * so periodic polling of those repos can stop. A repo only reaches
 * `listening` on an open socket, and drops out of it the moment the
 * socket fails or the server loses the subscription.
 */
export function isRepoListening(state: RootState, ids: string[]): boolean {
  if (ids.length === 0) return false
  for (const id of ids) {
    const status = state.storageWallets[id]?.subscription.status
    if (status !== 'listening' && status !== 'syncing') return false
  }
  return true
}

/**
 * Keeps a repo-polling task in step with the repo's subscription.
 * Polling stops while the sync server is listening, and resumes the
 * moment it is not.
 */
export function makeRepoPollingTask(task: () => Promise<void>): {
  update: (listening: boolean) => void
  stop: () => void
} {
  const { syncInterval } = storageSyncConfig
  const periodic = makePeriodicTask(task, syncInterval)
  let lastListening: boolean | undefined

  return {
    update(listening) {
      if (listening === lastListening) return
      lastListening = listening
      periodic.stop()
      if (listening) return
      periodic.start({ wait: syncInterval * (1 + Math.random()) })
    },

    stop() {
      lastListening = undefined
      periodic.stop()
    }
  }
}

export async function addStorageWallet(
  ai: ApiInput,
  walletInfo: EdgeWalletInfo
): Promise<void> {
  const { dispatch, io, onError } = ai.props

  const storageKeys = asEdgeStorageKeys(walletInfo.keys)
  const paths = makeRepoPaths(io, storageKeys)
  const localDisklet = makeLocalDisklet(io, walletInfo.id)
  bridgifyObject(localDisklet)

  const status: StorageWalletStatus = await loadRepoStatus(paths)

  // Upload local writes as they happen, since a subscribed repo
  // does not poll:
  const upload = makeRepoUploader(ai, walletInfo.id)
  watchRepoWrites(io, storageKeys.syncKey, upload)

  // A repo that has synced before can leave its first sync to the
  // sync-server subscription, which reports whether it has changed:
  const syncOwed =
    status.lastSync > 0 && ai.props.state.syncWebSocketServers.length > 0
  dispatch({
    type: 'STORAGE_WALLET_ADDED',
    payload: {
      id: walletInfo.id,
      initialState: {
        localDisklet,
        paths,
        status,
        lastChanges: [],
        subscription: { status: 'unsubscribed', syncOwed }
      }
    }
  })
  if (syncOwed) {
    // Edits from before a logout or a crash still need uploading,
    // even if the subscription reports no remote changes:
    if (await hasLocalChanges(paths)) upload()
    return
  }

  // If we have already done a sync, let this one run in the background:
  const syncPromise = syncStorageWallet(ai, walletInfo.id)
  if (status.lastSync > 0) {
    syncPromise.catch(error => {
      const { syncKey } = walletInfo.keys
      const { lastHash } = status
      ai.props.log.error(
        `Could not sync ${String(syncKey)} with last hash ${String(
          lastHash
        )}: ${String(error)}`
      )
      onError(error)
    })
  } else await syncPromise
}

/**
 * True while a logged-in account uses the repo.
 */
function isRepoInUse(state: RootState, walletId: string): boolean {
  if (state.currency?.currencyWalletIds?.includes(walletId)) {
    return true
  }
  return (state.accountIds ?? []).some(
    accountId =>
      state.accounts[accountId]?.accountWalletInfos.some(
        info => info.id === walletId
      )
  )
}

/**
 * Makes the upload trigger for one repo. Each call restarts a short
 * debounce, so a burst of writes becomes one upload. The upload goes
 * through the per-repo sync queue, so a write that lands during a sync
 * is uploaded by the next one, and a sync that leaves changes behind
 * (they upload 100 files at a time) is followed by another.
 * Failures retry with jittered exponential backoff while an account
 * still uses the repo. A write made just before logout gets one
 * upload attempt; anything left then waits for the next login,
 * which uploads pending changes when it attaches the repo.
 */
function makeRepoUploader(ai: ApiInput, walletId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let running = false
  let again = false

  function schedule(delayMs: number): void {
    if (timer != null) clearTimeout(timer)
    timer = setTimeout(run, delayMs)
  }

  function run(): void {
    timer = undefined
    if (running) {
      again = true
      return
    }
    running = true
    syncRepoAndReload(ai, walletId)
      .then(async () => {
        failures = 0
        const storageWallet = ai.props.state.storageWallets?.[walletId]
        if (
          storageWallet != null &&
          (await hasLocalChanges(storageWallet.paths))
        ) {
          again = true
        }
      })
      .catch((error: unknown) => {
        ++failures
        ai.props.log.warn(
          `Upload of repo ${walletId} failed (attempt ${failures}): ${String(
            error
          )}`
        )
        let inUse = false
        try {
          inUse = isRepoInUse(ai.props.state, walletId)
        } catch (error: unknown) {}
        if (!inUse) return
        const { uploadRetryBaseMs, uploadRetryMaxMs } = storageSyncConfig
        const ceiling = Math.min(
          uploadRetryMaxMs,
          uploadRetryBaseMs * 2 ** (failures - 1)
        )
        schedule(ceiling * (0.5 + Math.random() / 2))
      })
      .then(() => {
        running = false
        if (again) {
          again = false
          schedule(storageSyncConfig.uploadDebounceMs)
        }
      })
      .catch(() => {})
  }

  return () => schedule(storageSyncConfig.uploadDebounceMs)
}

/**
 * Syncs a repo, then reloads the account files that live in it
 * if it belongs to an account.
 */
export async function syncRepoAndReload(
  ai: ApiInput,
  walletId: string
): Promise<void> {
  const changes = await syncStorageWallet(ai, walletId)
  if (changes.length === 0) return

  const { state } = ai.props
  for (const accountId of state.accountIds) {
    const account = state.accounts[accountId]
    if (account == null) continue
    if (!account.accountWalletInfos.some(info => info.id === walletId)) {
      continue
    }
    // An account still booting reads these files from disk once its
    // own load lands, so a sync must not race that load:
    await Promise.all([
      account.pluginSettingsLoaded
        ? reloadPluginSettings(ai, accountId)
        : undefined,
      account.walletStatesLoaded
        ? loadAllWalletStates(ai, accountId)
        : undefined
    ])
  }
}

/**
 * Syncs are serialized per repo: `syncRepo` snapshots the changes
 * folder before its network round trip and deletes those paths after
 * it, so two in-flight syncs on one repo could double-upload or drop
 * a write that landed between them. Every caller funnels through
 * here (the boot's `addStorageWallet`, the periodic timers, and the
 * user-facing `sync()` methods), so overlapping requests simply run
 * one after the other.
 */
const storageSyncQueues = new Map<string, Promise<unknown>>()

export function syncStorageWallet(
  ai: ApiInput,
  walletId: string
): Promise<string[]> {
  const prev = storageSyncQueues.get(walletId) ?? Promise.resolve()
  const out = prev.then(async () => await doSyncStorageWallet(ai, walletId))
  const tail = out.then(
    () => undefined,
    () => undefined
  )
  storageSyncQueues.set(walletId, tail)
  tail
    .then(() => {
      if (storageSyncQueues.get(walletId) === tail) {
        storageSyncQueues.delete(walletId)
      }
    })
    .catch(() => undefined)
  return out
}

async function doSyncStorageWallet(
  ai: ApiInput,
  walletId: string
): Promise<string[]> {
  const { dispatch, syncClient, state } = ai.props

  // The wallet may have been deleted (or the user logged out)
  // while this sync waited in line:
  const storageWallet = state.storageWallets[walletId]
  if (storageWallet == null) {
    throw new Error('This storage wallet is no longer attached')
  }
  const { paths, status } = storageWallet

  return await syncRepo(syncClient, paths, { ...status }).then(
    ({ changes, status }) => {
      dispatch({
        type: 'STORAGE_WALLET_SYNCED',
        payload: { id: walletId, changes: Object.keys(changes), status }
      })
      return Object.keys(changes)
    }
  )
}

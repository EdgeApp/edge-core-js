import { bridgifyObject } from 'yaob'

import { EdgeWalletInfo } from '../../types/types'
import { makePeriodicTask } from '../../util/periodic-task'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput } from '../root-pixie'
import { RootState } from '../root-reducer'
import {
  loadRepoStatus,
  makeLocalDisklet,
  makeRepoPaths,
  syncRepo
} from './repo'
import { StorageWalletStatus } from './storage-reducer'

export const SYNC_INTERVAL = 30 * 1000

/**
 * Repo polling intervals. Mutable so tests can shrink them,
 * following the `accountCacheSaverConfig` pattern.
 */
export const storageSyncConfig: {
  syncInterval: number
} = {
  syncInterval: SYNC_INTERVAL
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
  if (syncOwed) return

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

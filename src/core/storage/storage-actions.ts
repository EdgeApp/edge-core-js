import { bridgifyObject } from 'yaob'

import { EdgeWalletInfo } from '../../types/types'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput } from '../root-pixie'
import {
  loadRepoStatus,
  makeLocalDisklet,
  makeRepoPaths,
  syncRepo
} from './repo'
import { StorageWalletStatus } from './storage-reducer'

export const SYNC_INTERVAL = 30 * 1000

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
  dispatch({
    type: 'STORAGE_WALLET_ADDED',
    payload: {
      id: walletInfo.id,
      initialState: {
        localDisklet,
        paths,
        status,
        lastChanges: []
      }
    }
  })

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

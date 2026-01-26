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

export async function syncStorageWallet(
  ai: ApiInput,
  walletId: string
): Promise<string[]> {
  const { dispatch, syncClient, state } = ai.props
  const { paths, status } = state.storageWallets[walletId]

  const result = await syncRepo(syncClient, paths, status)

  // Save the updated status to disk:
  await paths.baseDisklet.setText('status.json', JSON.stringify(result.status))

  dispatch({
    type: 'STORAGE_WALLET_SYNCED',
    payload: {
      id: walletId,
      changes: Object.keys(result.changes),
      status: result.status
    }
  })

  return Object.keys(result.changes)
}

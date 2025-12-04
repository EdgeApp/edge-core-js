import { Disklet, mergeDisklets, navigateDisklet } from 'disklet'
import { SyncClient, SyncResult } from 'edge-sync-client'
import { base16, base64 } from 'rfc4648'

import { wasEdgeBox } from '../../types/server-cleaners'
import { EdgeBox } from '../../types/server-types'
import { EdgeIo } from '../../types/types'
import { sha256 } from '../../util/crypto/hashes'
import { base58 } from '../../util/encoding'
import { EdgeStorageKeys } from '../login/storage-keys'
import { encryptDisklet } from './encrypt-disklet'
import { StorageWalletPaths, StorageWalletStatus } from './storage-reducer'

interface RepoChanges {
  [path: string]: EdgeBox | null
}

export function makeLocalDisklet(io: EdgeIo, walletId: string): Disklet {
  return navigateDisklet(
    io.disklet,
    'local/' + base58.stringify(base64.parse(walletId))
  )
}

/**
 * Sets up the back-end folders needed to emulate Git on disk.
 * You probably don't want this.
 */
export function makeRepoPaths(
  io: EdgeIo,
  storageKeys: EdgeStorageKeys
): StorageWalletPaths {
  const { dataKey, syncKey } = storageKeys
  const baseDisklet = navigateDisklet(
    io.disklet,
    'repos/' + base58.stringify(sha256(sha256(syncKey)))
  )
  const changesDisklet = navigateDisklet(baseDisklet, 'changes')
  const dataDisklet = navigateDisklet(baseDisklet, 'data')
  const disklet = encryptDisklet(
    io,
    dataKey,
    mergeDisklets(changesDisklet, dataDisklet)
  )

  return {
    dataKey,
    syncKey,

    baseDisklet,
    changesDisklet,
    dataDisklet,
    disklet
  }
}

export function loadRepoStatus(
  paths: StorageWalletPaths
): Promise<StorageWalletStatus> {
  const fallback = { lastSync: 0, lastHash: undefined }
  return paths.baseDisklet
    .getText('status.json')
    .then(text => ({ lastSync: 0, ...JSON.parse(text) }))
    .catch(() => fallback)
}

/**
 * This will save a change-set into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export async function saveChanges(
  disklet: Disklet,
  changes: RepoChanges
): Promise<void> {
  await Promise.all(
    Object.keys(changes).map(path => {
      const box = changes[path]
      return box != null
        ? disklet.setText(path, JSON.stringify(wasEdgeBox(box)))
        : disklet.delete(path)
    })
  )
}

/**
 * Synchronizes the local store with the remote server.
 */
export async function syncRepo(
  syncClient: SyncClient,
  paths: StorageWalletPaths,
  status: StorageWalletStatus
): Promise<SyncResult> {
  const syncKeyEncoded = base16.stringify(paths.syncKey).toLowerCase()
  return await syncClient.syncRepo(
    paths.baseDisklet,
    syncKeyEncoded,
    status.lastHash
  )
}

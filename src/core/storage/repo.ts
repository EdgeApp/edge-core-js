import { Disklet, mergeDisklets, navigateDisklet } from 'disklet'
import type { EdgeBox as SyncEdgeBox } from 'edge-sync-client'
import { SyncClient } from 'edge-sync-client'
import { base16, base64 } from 'rfc4648'

import { asEdgeBox, wasEdgeBox } from '../../types/server-cleaners'
import { EdgeBox } from '../../types/server-types'
import { EdgeIo } from '../../types/types'
import { sha256 } from '../../util/crypto/hashes'
import { base58 } from '../../util/encoding'
import { EdgeStorageKeys } from '../login/storage-keys'
import { encryptDisklet } from './encrypt-disklet'
import { StorageWalletPaths, StorageWalletStatus } from './storage-reducer'

const CHANGESET_MAX_ENTRIES = 100

interface RepoChanges {
  [path: string]: EdgeBox | null
}

export interface SyncResult {
  changes: RepoChanges
  status: StorageWalletStatus
}

export function makeLocalDisklet(io: EdgeIo, walletId: string): Disklet {
  return navigateDisklet(
    io.disklet,
    'local/' + base58.stringify(base64.parse(walletId))
  )
}

/**
 * The sync server's public name for a repo, `base58(sha256(sha256(syncKey)))`.
 * It names the repo's folder on disk and its WebSocket subscription,
 * without revealing the sync key, which grants read/write access.
 */
export function syncKeyToRepoId(syncKey: Uint8Array): string {
  return base58.stringify(sha256(sha256(syncKey)))
}

/**
 * Masks sync keys in text bound for the log. A sync key grants
 * read/write access to its repo, and network errors quote the store
 * URL, which carries the key as 40 hex digits.
 */
export function redactSyncKeys(text: string): string {
  return text.replace(/\b[0-9a-fA-F]{40}\b/g, '<syncKey>')
}

/**
 * Describes an error for the log, with any sync keys masked.
 */
export function describeSyncError(error: unknown): string {
  return redactSyncKeys(String(error))
}

/**
 * Upload triggers for local repo writes, keyed by the device disklet
 * and then by repo ID, so every `makeRepoPaths` instance for a repo
 * reaches the same listener, including ones made before the repo
 * was attached.
 */
const repoWriteWatchers = new WeakMap<Disklet, Map<string, () => void>>()

/**
 * Calls `onWrite` after every local write or delete through the
 * repo's synced disklet. Returns an unsubscribe function.
 */
export function watchRepoWrites(
  io: EdgeIo,
  syncKey: Uint8Array,
  onWrite: () => void
): () => void {
  const repoId = syncKeyToRepoId(syncKey)
  let watchers = repoWriteWatchers.get(io.disklet)
  if (watchers == null) {
    watchers = new Map()
    repoWriteWatchers.set(io.disklet, watchers)
  }
  watchers.set(repoId, onWrite)
  return () => {
    if (watchers?.get(repoId) === onWrite) watchers.delete(repoId)
  }
}

/**
 * Wraps the changes folder so writes and deletes that succeed
 * notify the repo's upload trigger.
 */
function watchWrites(disklet: Disklet, notify: () => void): Disklet {
  async function after<T>(promise: Promise<T>): Promise<T> {
    const out = await promise
    notify()
    return out
  }
  return {
    ...disklet,
    delete: async path => await after(disklet.delete(path)),
    setData: async (path, data) => await after(disklet.setData(path, data)),
    setText: async (path, text) => await after(disklet.setText(path, text))
  }
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
  const repoId = syncKeyToRepoId(syncKey)
  const baseDisklet = navigateDisklet(io.disklet, 'repos/' + repoId)
  const changesDisklet = navigateDisklet(baseDisklet, 'changes')
  const dataDisklet = navigateDisklet(baseDisklet, 'data')

  // Local edits land in the changes folder, which only a sync uploads,
  // so every edit asks for one. `syncRepo` clears the folder through
  // the unwatched `changesDisklet`, so it does not ask for another:
  const watchedChanges = watchWrites(
    changesDisklet,
    () => repoWriteWatchers.get(io.disklet)?.get(repoId)?.()
  )
  const disklet = encryptDisklet(
    io,
    dataKey,
    mergeDisklets(watchedChanges, dataDisklet)
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
  const { changesDisklet, dataDisklet, syncKey } = paths

  const ourChanges: Array<{
    path: string
    box: EdgeBox
  }> = await deepListWithLimit(changesDisklet).then(paths => {
    return Promise.all(
      paths.map(async path => ({
        path,
        box: asEdgeBox(JSON.parse(await changesDisklet.getText(path)))
      }))
    )
  })

  const syncKeyEncoded = base16.stringify(syncKey).toLowerCase()

  // Send a read request if no changes present locally, otherwise bundle the
  // changes with the a update request.
  const reply = await (() => {
    // Read the repo if no changes present locally.
    if (ourChanges.length === 0) {
      return syncClient.readRepo(syncKeyEncoded, status.lastHash)
    }

    // Write local changes to the repo.
    const changes: { [name: string]: SyncEdgeBox } = {}
    for (const change of ourChanges) {
      changes[change.path] = wasEdgeBox(change.box)
    }
    return syncClient.updateRepo(syncKeyEncoded, status.lastHash, { changes })
  })()

  // Make the request:
  const { hash } = reply
  const changes: RepoChanges = {}
  for (const path of Object.keys(reply.changes ?? {})) {
    const json = reply.changes[path]
    changes[path] = json == null ? null : asEdgeBox(json)
  }

  // Save the incoming changes into our `data` folder:
  await saveChanges(dataDisklet, changes)

  // Delete any changed keys (since the upload is done):
  await Promise.all(
    ourChanges.map(change => changesDisklet.delete(change.path))
  )

  // Update the repo status:
  status.lastSync = Date.now() / 1000
  if (hash != null) status.lastHash = hash
  await paths.baseDisklet.setText('status.json', JSON.stringify(status))
  return { status, changes }
}

/**
 * True if the repo holds local changes that have not been uploaded.
 */
export async function hasLocalChanges(
  paths: StorageWalletPaths
): Promise<boolean> {
  const list = await deepListWithLimit(paths.changesDisklet, '', 1)
  return list.length > 0
}

/**
 * Lists all files in a disklet, recursively up to a limit.
 * Returns a list of full paths.
 */
async function deepListWithLimit(
  disklet: Disklet,
  path: string = '',
  limit: number = CHANGESET_MAX_ENTRIES
): Promise<string[]> {
  const list = await disklet.list(path)
  const paths = Object.keys(list).filter(path => list[path] === 'file')
  const folders = Object.keys(list).filter(path => list[path] === 'folder')

  // Loop over folders to get subpaths
  for (const folder of folders) {
    if (paths.length >= limit) break
    const remaining = limit - paths.length
    const subpaths = await deepListWithLimit(disklet, folder, remaining)
    paths.push(...subpaths.slice(0, remaining))
  }

  return paths
}

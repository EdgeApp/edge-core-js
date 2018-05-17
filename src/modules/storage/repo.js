// @flow

import { locateFile, makeUnionFolder, mapAllFiles } from 'disklet'

import type {
  DiskletFolder,
  EdgeIo,
  EdgeWalletInfo
} from '../../edge-core-index.js'
import { sha256 } from '../../util/crypto/crypto.js'
import { base16, base58, base64 } from '../../util/encoding.js'
import { RepoFolder } from './repoFolder.js'
import type {
  StorageWalletPaths,
  StorageWalletStatus
} from './storage-reducer.js'
import { syncRequest } from './storage-servers.js'

/**
 * Sets up the back-end folders needed to emulate Git on disk.
 * You probably don't want this.
 */
export function makeRepoPaths (
  io: EdgeIo,
  walletInfo: EdgeWalletInfo
): StorageWalletPaths {
  const dataKey = base64.parse(walletInfo.keys.dataKey)
  const syncKey = base64.parse(walletInfo.keys.syncKey)
  const base = io.folder
    .folder('repos')
    .folder(base58.stringify(sha256(sha256(syncKey))))
  const changesFolder = base.folder('changes')
  const dataFolder = base.folder('data')
  const unionFolder = makeUnionFolder(changesFolder, dataFolder)

  return {
    dataKey,
    syncKey,
    changesFolder,
    dataFolder,
    folder: new RepoFolder(io, dataKey, unionFolder),
    statusFile: base.file('status.json')
  }
}

export function loadRepoStatus (
  paths: StorageWalletPaths
): Promise<StorageWalletStatus> {
  const fallback = { lastSync: 0, lastHash: void 0 }
  return paths.statusFile
    .getText()
    .then(text => ({ lastSync: 0, ...JSON.parse(text) }))
    .catch(e => fallback)
}

/**
 * This will save a change-set into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export function saveChanges (
  folder: DiskletFolder,
  changes: { [path: string]: Object }
) {
  return Promise.all(
    Object.keys(changes).map(path => {
      const json = changes[path]
      const file = locateFile(folder, path)

      return json != null ? file.setText(JSON.stringify(json)) : file.delete()
    })
  )
}

/**
 * Synchronizes the local store with the remote server.
 */
export function syncRepo (
  io: EdgeIo,
  paths: StorageWalletPaths,
  status: StorageWalletStatus
) {
  const { changesFolder, dataFolder, statusFile, syncKey } = paths

  return mapAllFiles(changesFolder, (file, name) =>
    file.getText().then(text => ({ file, name, json: JSON.parse(text) }))
  ).then(ourChanges => {
    // If we have local changes, we need to bundle those:
    const request = {}
    if (ourChanges.length > 0) {
      request.changes = {}
      for (const change of ourChanges) {
        request.changes[change.name] = change.json
      }
    }
    const method = request.changes ? 'POST' : 'GET'

    // Calculate the URI:
    let path = '/api/v2/store/' + base16.stringify(syncKey)
    if (status.lastHash != null) {
      path += '/' + status.lastHash
    }

    // Make the request:
    return syncRequest(io, method, path, request).then(reply => {
      const { changes = {}, hash } = reply

      // Save the incoming changes into our `data` folder:
      return saveChanges(dataFolder, changes)
        .then(
          // Delete any changed keys (since the upload is done):
          () => Promise.all(ourChanges.map(change => change.file.delete()))
        )
        .then(() => {
          // Update the repo status:
          status.lastSync = Date.now() / 1000
          if (hash != null) status.lastHash = hash
          return statusFile
            .setText(JSON.stringify(status))
            .then(() => ({ status, changes }))
        })
    })
  })
}

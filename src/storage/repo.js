import { hmacSha256, sha256 } from '../crypto/crypto.js'
import { base16, base58, base64 } from '../util/encoding.js'
import { locateFile, mapAllFiles, makeUnionFolder } from 'disklet'
import { RepoFolder } from './repoFolder.js'
import { syncRequest } from './servers.js'

/**
 * Creates a secure file name by hashing
 * the provided binary data with the repo's dataKey.
 */
export function secureFilename (dataKey, data) {
  return base58.stringify(hmacSha256(data, dataKey)) + '.json'
}

/**
 * Sets up the back-end folders needed to emulate Git on disk.
 * You probably don't want this.
 */
export function makeRepoFolders (io, keyInfo) {
  const syncKey = base64.parse(keyInfo.keys.syncKey)
  const base = io.folder
    .folder('repos')
    .folder(base58.stringify(sha256(sha256(syncKey))))

  return {
    base,
    changes: base.folder('changes'),
    data: base.folder('data')
  }
}

/**
 * Creates a folder instance that writes to the synced data area on disk.
 */
export function makeRepoFolder (io, keyInfo) {
  const dataKey = base64.parse(keyInfo.keys.dataKey)

  const folders = makeRepoFolders(io, keyInfo)
  const union = makeUnionFolder(folders.changes, folders.data)
  return new RepoFolder(io, dataKey, union)
}

/**
 * This will save a changeset into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export function saveChanges (folder, changes) {
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
export function syncRepo (io, keyInfo) {
  const syncKey = base64.parse(keyInfo.keys.syncKey)
  const folders = makeRepoFolders(io, keyInfo)

  return Promise.all([
    mapAllFiles(folders.changes, (file, name) =>
      file.getText().then(text => ({ file, name, json: JSON.parse(text) }))
    ),
    folders.base
      .file('status.json')
      .getText()
      .then(text => JSON.parse(text).lastHash)
      .catch(e => null)
  ]).then(values => {
    const [ourChanges, lastHash] = values

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
    if (lastHash != null) {
      path += '/' + lastHash
    }

    // Make the request:
    return syncRequest(io, method, path, request).then(reply => {
      const { changes, hash } = reply
      const changed = changes != null && Object.keys(changes).length

      // Save the incoming changes into our `data` folder:
      const promise = changes != null
        ? saveChanges(folders.data, changes)
        : Promise.resolve()

      return promise
        .then(
          // Delete any changed keys (since the upload is done):
          () => Promise.all(ourChanges.map(change => change.file.delete()))
        )
        .then(() => {
          // Save the current hash:
          if (hash != null) {
            folders.base
              .file('status.json')
              .setText(JSON.stringify({ lastHash: hash }))
              .then(() => changed)
          }
          return changed
        })
    })
  })
}

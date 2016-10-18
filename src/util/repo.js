import { decrypt, encrypt, hmacSha256 } from '../crypto/crypto.js'
import { base16, base58, utf8 } from './encoding.js'

const syncServers = [
  'https://git-js.airbitz.co',
  'https://git4-js.airbitz.co'
]

/**
 * Fetches some resource from a sync server.
 */
function syncRequest (io, method, uri, body) {
  return syncRequestInner(io, method, uri, body, 0)
}

function syncRequestInner (io, method, uri, body, serverIndex) {
  uri = syncServers[serverIndex] + uri
  io.log.info(`sync: ${method} ${uri}`)
  const headers = {
    method: method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  }
  if (method !== 'GET') {
    headers.body = JSON.stringify(body)
  }

  return io.fetch(uri, headers).then(response => {
    return response.json().catch(jsonError => {
      throw new Error('Non-JSON reply, HTTP status ' + response.status)
    })
  }, networkError => {
    if (serverIndex + 1 < syncServers.length) {
      return syncRequestInner(io, method, uri, body, serverIndex + 1)
    }
    throw new Error('NetworkError: Could not connect to sync server')
  })
}

/**
 * Navigates down to the sub-folder indicated by the path.
 * Returns the folder object and the filename in an object.
 */
function navigate (folder, path) {
  const parts = path.split('/')
  const filename = parts.pop()
  return {
    filename,
    folder: parts.reduce((folder, name) => folder.getFolder(name), folder)
  }
}

/**
 * Builds an object containing the folder's complete contents.
 */
function bundleChanges (folder, changes = {}, prefix = '') {
  folder.listFiles().forEach(name => {
    changes[prefix + name] = folder.getFileJson(name)
  })
  folder.listFolders().forEach(name => {
    bundleChanges(folder.getFolder(name), changes, name + '/')
  })
  return changes
}

/**
 * This will merge a changeset into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export function mergeChanges (store, changes) {
  Object.keys(changes).forEach(path => {
    const { filename, folder } = navigate(store, path)
    if (changes[path] == null) {
      folder.removeFile(filename)
    } else {
      folder.setFileJson(filename, changes[path])
    }
  })
}

/**
 * Creates an ID string from a repo's dataKey.
 */
export function repoId (dataKey) {
  return base58.stringify(hmacSha256(dataKey, dataKey))
}

/**
 * Creates a data storage and syncing object.
 * The data inside the repo is encrypted with `dataKey`.
 */
export function Repo (io, dataKey, syncKey) {
  this.io = io
  this.dataKey = dataKey
  this.syncKey = syncKey

  this.store = io.folder.getFolder('repos').getFolder(repoId(dataKey))
  this.changeStore = this.store.getFolder('changes')
  this.dataStore = this.store.getFolder('data')
}

/**
 * Creates a secure file name by hashing
 * the provided binary data with the repo's dataKey.
 */
Repo.prototype.secureFilename = function (data) {
  return base58.stringify(hmacSha256(data, this.dataKey)) + '.json'
}

/**
 * Decrypts and returns the file at the given path.
 * The return value will either be a byte buffer or null.
 */
Repo.prototype.getData = function (path) {
  const { filename, folder } = navigate(this.changeStore, path)
  let box = folder.getFileJson(filename)
  if (box == null) {
    const { filename, folder } = navigate(this.dataStore, path)
    box = folder.getFileJson(filename)
  }
  return box ? decrypt(box, this.dataKey) : null
}

/**
 * Decrypts and returns the file at the given path,
 * treating the contents as text.
 */
Repo.prototype.getText = function (path) {
  let data = this.getData(path)
  if (data == null) {
    return null
  }
  // Due to a legacy bug, some Airbitz data contains trailing nulls:
  if (data.length && data[data.length - 1] === 0) {
    data = data.slice(0, data.length - 1)
  }
  return utf8.stringify(data)
}

/**
 * Decrypts and returns the file at the given path,
 * treating the contents as JSON.
 */
Repo.prototype.getJson = function (path) {
  const text = this.getText(path)
  return text == null ? null : JSON.parse(text)
}

/**
 * Lists the files (not folders) contained in the given path.
 */
Repo.prototype.keys = function (path) {
  path = path + '/'
  const changeFiles = navigate(this.changeStore, path).folder.listFiles()
  const dataFiles = navigate(this.dataStore, path).folder.listFiles()
  const files = [...changeFiles, ...dataFiles]

  // Remove duplicates:
  return files.sort().filter(function (item, i, array) {
    return !i || item !== array[i - 1]
  })
}

/**
 * Deletes a particular file path.
 */
Repo.prototype.removeItem = function (path) {
  const { filename, folder } = navigate(this.changeStore, path)
  folder.setFileJson(filename, null)
}

/**
 * Encrypts a value and saves it at the provided file path.
 * The value must be either a byte buffer or null.
 */
Repo.prototype.setData = function (path, value) {
  const { filename, folder } = navigate(this.changeStore, path)
  folder.setFileJson(filename, encrypt(this.io, value, this.dataKey))
}

/**
 * Encrypts a text string and saves it as the provided file path.
 */
Repo.prototype.setText = function (path, value) {
  return this.setData(path, utf8.parse(value))
}

/**
 * Encrypts a JSON object and saves it as the provided file path.
 */
Repo.prototype.setJson = function (path, value) {
  return this.setText(path, JSON.stringify(value))
}

/**
 * Synchronizes the local store with the remote server.
 */
Repo.prototype.sync = function () {
  const self = this

  // If we have local changes, we need to bundle those:
  const request = {}
  const changes = bundleChanges(this.changeStore)
  const changeKeys = Object.keys(changes)
  if (changeKeys.length > 0) {
    request.changes = changes
  }

  // Calculate the URI:
  let uri = '/api/v2/store/' + base16.stringify(this.syncKey)
  const lastHash = this.store.getFileText('lastHash')
  if (lastHash != null) {
    uri = uri + '/' + lastHash
  }

  // Make the request:
  return syncRequest(this.io, request.changes ? 'POST' : 'GET', uri, request).then(reply => {
    let changed = false

    // Delete any changed keys (since the upload is done):
    changeKeys.forEach(path => {
      const { filename, folder } = navigate(this.changeStore, path)
      folder.removeFile(filename)
    })

    // Process the change list:
    const changes = reply['changes']
    if (changes != null) {
      if (Object.keys(changes).length > 0) {
        changed = true
      }
      mergeChanges(self.dataStore, changes)
    }

    // Save the current hash:
    const hash = reply['hash']
    if (hash != null) {
      self.store.setFileText('lastHash', hash)
    }

    return changed
  })
}

import { decrypt, encrypt, hmacSha256 } from '../crypto/crypto.js'
import {base16, base58, utf8} from './encoding.js'
import {ScopedStorage} from './scopedStorage.js'

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
 * Normalizes a path, returning its components as an array.
 */
function pathSplit (path) {
  // TODO: Handle dots (escapes, `.`, and `..`).
  return path.split('/')
}

/**
 * Converts a server-format path to our internal format.
 */
function pathFix (path) {
  if (path.slice(-5) !== '.json') {
    return null
  }
  return pathSplit(path.slice(0, -5)).join('.')
}

/**
 * This will merge a changeset into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export function mergeChanges (store, changes) {
  Object.keys(changes).forEach(key => {
    const path = pathFix(key)
    if (path != null) {
      store.setJson(path, changes[key])
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

  const prefix = 'airbitz.repo.' + repoId(dataKey)
  this.store = new ScopedStorage(io.localStorage, prefix)
  this.changeStore = this.store.subStore('changes')
  this.dataStore = this.store.subStore('data')
}

/**
 * Creates a secure file name by hashing
 * the provided binary data with the repo's dataKey.
 */
Repo.prototype.secureFilename = function (data) {
  return base58.stringify(hmacSha256(data, this.dataKey))
}

/**
 * Decrypts and returns the file at the given path.
 * The return value will either be a byte buffer or null.
 */
Repo.prototype.getData = function (path) {
  path = pathSplit(path).join('.')

  const box =
    this.changeStore.getJson(path) ||
    this.dataStore.getJson(path)
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
  path = path ? pathSplit(path).join('.') + '.' : ''
  const search = new RegExp('^' + path + '([^\\.]+)$')
  function filter (key) {
    return search.test(key)
  }
  function strip (key) {
    return key.replace(search, '$1')
  }

  const changeKeys = this.changeStore.keys().filter(filter).map(strip)
  const dataKeys = this.dataStore.keys().filter(filter).map(strip)
  const keys = changeKeys.concat(dataKeys)

  // Remove duplicates:
  return keys.sort().filter(function (item, i, array) {
    return !i || item !== array[i - 1]
  })
}

/**
 * Deletes a particular file path.
 */
Repo.prototype.removeItem = function (path) {
  this.set(path, null)
}

/**
 * Encrypts a value and saves it at the provided file path.
 * The value must be either a byte buffer or null.
 */
Repo.prototype.setData = function (path, value) {
  if (/\./.test(path)) {
    throw new Error('Dots are not allowed in paths')
  }
  path += '.json'

  const changes = {}
  changes[path] = value ? encrypt(this.io, value, this.dataKey) : null
  mergeChanges(this.changeStore, changes)
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
  const changeKeys = this.changeStore.keys()
  if (changeKeys.length > 0) {
    request.changes = {}
    changeKeys.forEach(key => {
      const path = key.replace(/\./g, '/') + '.json'
      request.changes[path] = this.changeStore.getJson(key)
    })
  }

  // Calculate the URI:
  let uri = '/api/v2/store/' + base16.stringify(this.syncKey)
  const lastHash = this.store.getItem('lastHash')
  if (lastHash != null) {
    uri = uri + '/' + lastHash
  }

  // Make the request:
  return syncRequest(this.io, request.changes ? 'POST' : 'GET', uri, request).then(reply => {
    let changed = false

    // Delete any changed keys (since the upload is done):
    changeKeys.forEach(key => {
      self.changeStore.removeItem(key)
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
      self.store.setItem('lastHash', hash)
    }

    return changed
  })
}

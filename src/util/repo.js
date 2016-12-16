import * as crypto from '../crypto.js'
import {base58} from './encoding.js'
import {ScopedStorage} from './scopedStorage.js'

const syncServers = [
  'https://git-js.airbitz.co',
  'https://git4-js.airbitz.co'
]

/**
 * Fetches some resource from a sync server.
 */
function syncRequest (fetch, method, uri, body) {
  return syncRequestInner(fetch, method, uri, body, 0)
}

function syncRequestInner (fetch, method, uri, body, serverIndex) {
  console.log('syncRequestInner: Connecting to ' + syncServers[serverIndex])
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

  return fetch(syncServers[serverIndex] + uri, headers).then(response => {
    return response.json().catch(jsonError => {
      throw new Error('Non-JSON reply, HTTP status ' + response.status)
    })
  }, networkError => {
    if (serverIndex + 1 < syncServers.length) {
      return syncRequestInner(fetch, method, uri, body, serverIndex + 1)
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
 * This will merge a changeset into the local storage.
 * This function ignores folder-level deletes and overwrites,
 * but those can't happen under the current rules anyhow.
 */
export function mergeChanges (store, changes) {
  for (let key in changes) {
    if (changes.hasOwnProperty(key)) {
      // Normalize the path:
      const path = pathSplit(key)
      if (!path.length) {
        continue
      }

      // Remove the `.json` extension from the filename:
      const filename = path[path.length - 1]
      if (filename.slice(-5) !== '.json') {
        continue
      }
      path[path.length - 1] = filename.slice(0, -5)

      // Write the value to storage:
      store.setJson(path.join('.'), changes[key])
    }
  }
}

/**
 * Creates an ID string from a repo's dataKey.
 */
export function repoId (dataKey) {
  return base58.encode(crypto.hmacSha256(dataKey, dataKey))
}

/**
 * Creates a data storage and syncing object.
 * The data inside the repo is encrypted with `dataKey`.
 */
export function Repo (ctx, dataKey, syncKey) {
  this.fetch = ctx.fetch
  this.dataKey = dataKey
  this.syncKey = syncKey

  const prefix = 'airbitz.repo.' + repoId(dataKey)
  this.store = new ScopedStorage(ctx.localStorage, prefix)
  this.changeStore = this.store.subStore('changes')
  this.dataStore = this.store.subStore('data')
}

/**
 * Creates a secure file name by hashing
 * the provided binary data with the repo's dataKey.
 */
Repo.prototype.secureFilename = function (data) {
  return base58.encode(crypto.hmacSha256(data, this.dataKey))
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
  return box ? crypto.decrypt(box, this.dataKey) : null
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
  return data.toString('utf-8')
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
  changes[path] = value ? crypto.encrypt(value, this.dataKey) : null
  mergeChanges(this.changeStore, changes)
}

/**
 * Encrypts a text string and saves it as the provided file path.
 */
Repo.prototype.setText = function (path, value) {
  return this.setData(path, new Buffer(value, 'utf-8'))
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
  if (changeKeys.length) {
    request.changes = {}
    for (let key of changeKeys) {
      const path = key.replace(/\./g, '/') + '.json'

      request.changes[path] = this.changeStore.getJson(key)
    }
  }

  // Calculate the URI:
  let uri = '/api/v2/store/' + this.syncKey.toString('hex')
  const lastHash = this.store.getItem('lastHash')
  if (lastHash) {
    uri = uri + '/' + lastHash
  }

  // Make the request:
  return syncRequest(this.fetch, request.changes ? 'POST' : 'GET', uri, request).then(reply => {
    let changed = false

    // Delete any changed keys (since the upload is done):
    for (let key of changeKeys) {
      self.changeStore.removeItem(key)
    }

    // Process the change list:
    const changes = reply['changes']
    if (changes) {
      for (let change in changes) {
        if (changes.hasOwnProperty(change)) {
          changed = true
          break
        }
      }
      mergeChanges(self.dataStore, changes)
    }

    // Save the current hash:
    const hash = reply['hash']
    if (hash) {
      self.store.setItem('lastHash', hash)
    }

    return changed
  })
}

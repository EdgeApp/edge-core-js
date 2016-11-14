var base58 = require('./encoding.js').base58
var crypto = require('../crypto.js')
var ScopedStorage = require('./scopedStorage').ScopedStorage

var syncServer = 'https://git1.sync.airbitz.co'

/**
 * Fetches some resource from a sync server.
 */
function syncRequest (authFetch, method, uri, body, callback) {
  authFetch(method, syncServer + uri, body, function (err, status, body) {
    if (err) return callback(err)
    try {
      var reply = JSON.parse(body)
    } catch (e) {
      return callback(Error('Non-JSON reply HTTP status ' + status))
    }

    return callback(null, reply)
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
function mergeChanges (store, changes) {
  for (var key in changes) {
    if (changes.hasOwnProperty(key)) {
      // Normalize the path:
      var path = pathSplit(key)
      if (!path.length) {
        continue
      }

      // Remove the `.json` extension from the filename:
      var filename = path[path.length - 1]
      if (filename.slice(-5) !== '.json') {
        continue
      }
      path[path.length - 1] = filename.slice(0, -5)

      // Write the value to storage:
      store.setJson(path.join('.'), changes[key])
    }
  }
}
exports.mergeChanges = mergeChanges

/**
 * Creates an ID string from a repo's dataKey.
 */
function repoId (dataKey) {
  return base58.encode(crypto.hmacSha256(dataKey, dataKey))
}
exports.repoId = repoId

/**
 * Creates a data storage and syncing object.
 * The data inside the repo is encrypted with `dataKey`.
 */
function Repo (ctx, dataKey, syncKey) {
  this.authFetch = ctx.authFetch
  this.dataKey = dataKey
  this.syncKey = syncKey

  var prefix = 'airbitz.repo.' + repoId(dataKey)
  this.store = new ScopedStorage(ctx.localStorage, prefix)
  this.changeStore = this.store.subStore('changes')
  this.dataStore = this.store.subStore('data')
}
exports.Repo = Repo

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

  var box =
    this.changeStore.getJson(path) ||
    this.dataStore.getJson(path)
  return box ? crypto.decrypt(box, this.dataKey) : null
}

/**
 * Decrypts and returns the file at the given path,
 * treating the contents as text.
 */
Repo.prototype.getText = function (path) {
  var data = this.getData(path)
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
  var text = this.getText(path)
  return text == null ? null : JSON.parse(text)
}

/**
 * Lists the files (not folders) contained in the given path.
 */
Repo.prototype.keys = function (path) {
  path = path ? pathSplit(path).join('.') + '.' : ''
  var search = new RegExp('^' + path + '([^\\.]+)$')
  function filter (key) {
    return search.test(key)
  }
  function strip (key) {
    return key.replace(search, '$1')
  }

  var changeKeys = this.changeStore.keys().filter(filter).map(strip)
  var dataKeys = this.dataStore.keys().filter(filter).map(strip)
  var keys = changeKeys.concat(dataKeys)

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

  var changes = {}
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
Repo.prototype.sync = function (callback) {
  var self = this

  // If we have local changes, we need to bundle those:
  var request = {}
  var changeKeys = this.changeStore.keys()
  if (changeKeys.length) {
    request.changes = {}
    for (var i = 0; i < changeKeys.length; ++i) {
      var key = changeKeys[i]
      var path = key.replace(/\./g, '/') + '.json'

      request.changes[path] = this.changeStore.getJson(key)
    }
  }

  // Calculate the URI:
  var uri = '/api/v2/store/' + this.syncKey.toString('hex')
  var lastHash = this.store.getItem('lastHash')
  if (lastHash) {
    uri = uri + '/' + lastHash
  }

  // Make the request:
  syncRequest(this.authFetch, request.changes ? 'POST' : 'GET', uri, request, function (err, reply) {
    if (err) return callback(err)

    try {
      var changed = false

      // Delete any changed keys (since the upload is done):
      for (var i = 0; i < changeKeys.length; ++i) {
        self.changeStore.removeItem(changeKeys[i])
      }

      // Process the change list:
      var changes = reply['changes']
      if (changes) {
        for (var change in changes) {
          if (changes.hasOwnProperty(change)) {
            changed = true
            break
          }
        }
        mergeChanges(self.dataStore, changes)
      }

      // Save the current hash:
      var hash = reply['hash']
      if (hash) {
        self.store.setItem('lastHash', hash)
      }
    } catch (e) {
      return callback(e)
    }
    callback(null, changed)
  })
}

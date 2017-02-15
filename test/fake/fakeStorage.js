import {base16} from '../../src/util/encoding.js'
import {ScopedStorage} from '../../src/util/scopedStorage.js'
import * as repoModule from '../../src/util/repo.js'
import * as packages from './packages.js'

/**
 * Emulates the `localStorage` browser API.
 */
export function FakeStorage () {
  this.items = {}
}
FakeStorage.prototype.getItem = function (key) {
  return key in this.items ? this.items[key] : null
}
FakeStorage.prototype.setItem = function (key, value) {
  this.items[key] = value
}
FakeStorage.prototype.removeItem = function (key) {
  delete this.items[key]
}
FakeStorage.prototype.key = function (n) {
  return Object.keys(this.items)[n]
}
Object.defineProperty(FakeStorage.prototype, 'length', {
  get: function () {
    return Object.keys(this.items).length
  }
})

/**
 * Fills the `FakeStorage` instance with just the user list.
 */
FakeStorage.prototype.populateUsers = function () {
  this.items['airbitz.users'] = JSON.stringify(packages.users)
}

/**
 * Fills the `FakeStorage` instance with repo data.
 */
FakeStorage.prototype.populateRepos = function () {
  Object.keys(packages.repos).forEach(syncKey => {
    const repo = new repoModule.Repo(
      {localStorage: this}, // Fake io object
      packages.dataKey,
      base16.parse(syncKey)
    )
    repoModule.mergeChanges(repo.dataStore, packages.repos[syncKey])
  })
}

/**
 * Fills the `FakeStorage` instance with account data.
 */
FakeStorage.prototype.populate = function () {
  this.populateUsers()
  this.populateRepos()
  const userStorage = new ScopedStorage(this, 'airbitz.user.js test 0')
  userStorage.setItems({
    passwordKeySnrp: packages.passwordKeySnrp,
    passwordBox: packages.passwordBox,
    passwordAuthBox: packages.passwordAuthBox,
    rootKeyBox: packages.rootKeyBox,
    syncKeyBox: packages.syncKeyBox,
    pinAuthId: packages.pinPackage['DID'],
    pinBox: packages.pinPackage['EMK_PINK'],
    pin2Key: packages.pin2Key,
    recovery2Key: packages.recovery2Key
  })
}

/**
 * Empties the `FakeStorage` instance.
 */
FakeStorage.prototype.clear = function () {
  this.items = {}
}

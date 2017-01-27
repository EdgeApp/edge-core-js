import {UserStorage} from '../../src/userStorage.js'
import {base16} from '../../src/util/encoding.js'
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
  for (const syncKey in packages.repos) {
    if (packages.repos.hasOwnProperty(syncKey)) {
      const repo = new repoModule.Repo(
        {localStorage: this},
        packages.dataKey,
        base16.parse(syncKey)
      )
      repoModule.mergeChanges(repo.dataStore, packages.repos[syncKey])
    }
  }
}

/**
 * Fills the `FakeStorage` instance with account data.
 */
FakeStorage.prototype.populate = function () {
  this.populateUsers()
  this.populateRepos()
  const userStorage = new UserStorage(this, 'js test 0')
  userStorage.setJson('passwordKeySnrp', packages.passwordKeySnrp)
  userStorage.setJson('passwordBox', packages.passwordBox)
  userStorage.setJson('passwordAuthBox', packages.passwordAuthBox)
  userStorage.setJson('rootKeyBox', packages.rootKeyBox)
  userStorage.setJson('syncKeyBox', packages.syncKeyBox)
  userStorage.setItem('pinAuthId', packages.pinPackage['DID'])
  userStorage.setJson('pinBox', packages.pinPackage['EMK_PINK'])
  userStorage.setItem('pin2Key', packages.pin2Key)
  userStorage.setItem('recovery2Key', packages.recovery2Key)
}

/**
 * Empties the `FakeStorage` instance.
 */
FakeStorage.prototype.clear = function () {
  this.items = {}
}

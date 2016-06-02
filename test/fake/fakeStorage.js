var packages = require('./packages.js')
var UserStorage = require('../../src/userStorage.js').UserStorage

/**
 * Emulates the `localStorage` browser API.
 */
function FakeStorage () {
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

/**
 * Fills the `FakeStorage` instance with just the user list.
 */
FakeStorage.prototype.populateUsers = function () {
  this.items['airbitz.users'] = JSON.stringify(packages.users)
}

/**
 * Fills the `FakeStorage` instance with account data.
 */
FakeStorage.prototype.populate = function () {
  this.populateUsers()
  var userStorage = new UserStorage(this, 'js test 0')
  userStorage.setJson('passwordKeySnrp', packages.carePackage['SNRP2'])
  userStorage.setJson('passwordBox', packages.loginPackage['EMK_LP2'])
  userStorage.setJson('authKeyBox', packages.loginPackage['ELP1'])
  userStorage.setJson('rootKeyBox', packages.rootKeyBox)
  userStorage.setJson('syncKeyBox', packages.loginPackage['ESyncKey'])
  userStorage.setItem('pinAuthId', packages.pinPackage['DID'])
  userStorage.setJson('pinBox', packages.pinPackage['EMK_PINK'])
}

exports.FakeStorage = FakeStorage

var ScopedStorage = require('./util/scopedStorage.js').ScopedStorage

/**
 * Returns a wrapped version of `localStorage` keyed to a specific user.
 */
function UserStorage (localStorage, username) {
  return ScopedStorage.call(this, localStorage, 'airbitz.user.' + username)
}
UserStorage.prototype = ScopedStorage.prototype

exports.UserStorage = UserStorage

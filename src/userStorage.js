import {ScopedStorage} from './util/scopedStorage.js'

/**
 * Returns a wrapped version of `localStorage` keyed to a specific user.
 */
export function UserStorage (localStorage, username) {
  return ScopedStorage.call(this, localStorage, 'airbitz.user.' + username)
}
UserStorage.prototype = ScopedStorage.prototype

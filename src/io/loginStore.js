import * as userMap from '../userMap.js'
import {ScopedStorage} from '../util/scopedStorage.js'

/**
 * Handles login data storage.
 * TODO: Make all methods async!
 */
export class LoginStore {
  constructor (io) {
    this.io = io
  }

  findUsername (username) {
    const path = 'airbitz.user.' + userMap.normalize(username)
    return new ScopedStorage(this.io.localStorage, path)
  }
}

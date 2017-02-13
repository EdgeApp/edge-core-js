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

  /**
   * Loads the loginData matching the given query.
   * For now, the query only supports the `username` property.
   */
  find (query) {
    const fixedName = userMap.normalize(query.username)
    const store = this.findUsername(fixedName)

    return {
      username: fixedName,

      passwordAuthBox: store.getJson('passwordAuthBox'),
      passwordBox: store.getJson('passwordBox'),
      passwordKeySnrp: store.getJson('passwordKeySnrp'),

      pin2Key: store.getItem('pin2Key'),
      recovery2Key: store.getItem('recovery2Key'),

      rootKeyBox: store.getJson('rootKeyBox'),
      syncKeyBox: store.getJson('syncKeyBox'),
      repos: store.getJson('repos') || []
    }
  }
}

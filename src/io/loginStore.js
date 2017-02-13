import * as userMap from '../userMap.js'
import {base64} from '../util/encoding.js'
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

  /**
   * Removes any loginData matching the given query.
   * For now, the query only supports the `username` property.
   */
  remove (query) {
    const fixedName = userMap.normalize(query.username)
    this.findUsername(fixedName).removeAll()
  }

  update (userId, loginData) {
    // Find the username:
    let username
    if ('username' in loginData) {
      username = loginData.username
      userMap.insert(this.io, username, userId)
    } else {
      const users = userMap.load(this.io)
      username = Object.keys(users).find(username => {
        return users[username] === base64.stringify(userId)
      })
      if (!username) {
        throw new Error('Cannot find userId')
      }
    }

    // Actually save:
    const store = this.findUsername(username)
    return store.setItems(loginData)
  }
}

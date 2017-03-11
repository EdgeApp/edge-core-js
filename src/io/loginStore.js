import * as scrypt from '../crypto/scrypt.js'
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

  /**
   * Finds the userId for a particular username.
   * TODO: Memoize this method.
   */
  getUserId (username) {
    const fixedName = fixUsername(username)
    const users = this._loadUsers(this.io)
    if (users[fixedName]) {
      return Promise.resolve(base64.parse(users[fixedName]))
    }
    return scrypt.scrypt(fixedName, scrypt.userIdSnrp)
  }

  /**
   * Loads the loginStash matching the given query.
   * For now, the query only supports the `username` property.
   */
  find (query) {
    const fixedName = fixUsername(query.username)
    const store = this._findUsername(fixedName)

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
   * Lists the usernames that have data in the store.
   */
  listUsernames () {
    const users = this._loadUsers()
    return Object.keys(users)
  }

  /**
   * Removes any loginStash matching the given query.
   * For now, the query only supports the `username` property.
   */
  remove (query) {
    const fixedName = fixUsername(query.username)
    this._findUsername(fixedName).removeAll()

    const users = this._loadUsers()
    delete users[fixedName]
    this.io.localStorage.setItem('airbitz.users', JSON.stringify(users))
  }

  update (userId, loginStash) {
    // Find the username:
    let username
    const users = this._loadUsers()
    if ('username' in loginStash) {
      username = loginStash.username

      // Add the userId to the table, in case it's new:
      users[username] = base64.stringify(userId)
      this.io.localStorage.setItem('airbitz.users', JSON.stringify(users))
    } else {
      username = Object.keys(users).find(username => {
        return users[username] === base64.stringify(userId)
      })
      if (!username) {
        throw new Error('Cannot find userId')
      }
    }

    // Actually save:
    const store = this._findUsername(username)
    return store.setItems(loginStash)
  }

  _findUsername (username) {
    const path = 'airbitz.user.' + fixUsername(username)
    return new ScopedStorage(this.io.localStorage, path)
  }

  _loadUsers () {
    try {
      const users = JSON.parse(this.io.localStorage.getItem('airbitz.users'))
      return users || {}
    } catch (e) {
      return {}
    }
  }
}

/**
 * Normalizes a username, and checks for invalid characters.
 * TODO: Support a wider character range via Unicode normalization.
 */
export function fixUsername (username) {
  const out = username
    .toLowerCase()
    .replace(/[ \f\r\n\t\v]+/g, ' ')
    .replace(/ $/, '')
    .replace(/^ /, '')

  for (let i = 0; i < out.length; ++i) {
    const c = out.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) {
      throw new Error('Bad characters in username')
    }
  }
  return out
}

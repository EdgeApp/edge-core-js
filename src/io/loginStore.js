import { scrypt, userIdSnrp } from '../crypto/scrypt.js'
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
   * Finds the loginStash for the given username.
   */
  load (username) {
    const loginStash = this.loadSync(username)
    if (loginStash.userId != null) {
      return Promise.resolve(loginStash)
    }

    return hashUsername(username).then(userId => {
      loginStash.userId = base64.stringify(userId)
      return loginStash
    })
  }

  /**
   * Same thing as `load`, but doesn't block on the `userId`.
   */
  loadSync (username) {
    const fixedName = fixUsername(username)
    const store = this._findUsername(fixedName)

    return {
      username: fixedName,
      appId: store.getItem('appId'),
      userId: this._loadUsers(this.io)[fixedName],

      passwordAuthBox: store.getJson('passwordAuthBox'),
      passwordBox: store.getJson('passwordBox'),
      passwordKeySnrp: store.getJson('passwordKeySnrp'),

      pin2Key: store.getItem('pin2Key'),
      recovery2Key: store.getItem('recovery2Key'),

      rootKeyBox: store.getJson('rootKeyBox'),
      syncKeyBox: store.getJson('syncKeyBox'),
      keyBoxes: store.getJson('keyBoxes') || []
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
   * Removes any loginStash that may be stored for the given username.
   */
  remove (username) {
    const fixedName = fixUsername(username)
    this._findUsername(fixedName).removeAll()

    const users = this._loadUsers()
    delete users[fixedName]
    this.io.localStorage.setItem('airbitz.users', JSON.stringify(users))
  }

  /**
   * Saves a loginStash.
   */
  save (loginStash) {
    return this.update(base64.parse(loginStash.userId), loginStash)
  }

  update (userId, loginStash) {
    if (userId.length !== 32) {
      throw new Error('Invalid userId')
    }

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

// Hashed username cache:
const userIdCache = {}

/**
 * Hashes a username into a userId.
 */
export function hashUsername (username) {
  const fixedName = fixUsername(username)
  if (userIdCache[fixedName] == null) {
    userIdCache[fixedName] = scrypt(fixedName, userIdSnrp)
  }
  return userIdCache[fixedName]
}

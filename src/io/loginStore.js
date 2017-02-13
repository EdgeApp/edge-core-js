import { scrypt, userIdSnrp } from '../crypto/scrypt.js'
import { base58, base64 } from '../util/encoding.js'
import { ScopedStorage } from '../util/scopedStorage.js'
import { objectAssign } from '../util/util.js'

/**
 * Handles login data storage.
 * TODO: Make all methods async!
 */
export class LoginStore {
  constructor (io) {
    this.storage = new ScopedStorage(io.localStorage, 'airbitz.login')
  }

  /**
   * Lists the usernames that have data in the store.
   */
  listUsernames () {
    return this.storage.keys().map(filename => {
      return this.storage.getJson(filename).username
    })
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
    const filename = this._findFilename(username)
    return filename != null
      ? this.storage.getJson(filename)
      : { username: fixUsername(username) }
  }

  /**
   * Removes any loginStash that may be stored for the given username.
   */
  remove (username) {
    const filename = this._findFilename(username)
    if (filename != null) {
      this.storage.removeItem(filename)
    }
  }

  /**
   * Saves a loginStash.
   */
  save (loginStash) {
    const userId = base64.parse(loginStash.userId)
    if (userId.length !== 32) {
      throw new Error('Invalid userId')
    }
    const filename = base58.stringify(userId)
    this.storage.setJson(filename, loginStash)
  }

  update (userId, loginStash) {
    if (userId.length !== 32) {
      throw new Error('Invalid userId')
    }
    const filename = base58.stringify(userId)
    const old = this.storage.getJson(filename)
    const out = old != null ? objectAssign(old, loginStash) : loginStash
    out.loginId = base64.stringify(userId)
    return this.save(out)
  }

  _findFilename (username) {
    const fixedName = fixUsername(username)
    return this.storage.keys().find(filename => {
      const loginStash = this.storage.getJson(filename)
      return loginStash && loginStash.username === fixedName
    })
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

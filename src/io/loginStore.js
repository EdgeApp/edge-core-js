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
    return Promise.resolve(this.loadSync(username))
  }

  /**
   * Same thing as `load`, but doesn't block on the `userId`.
   */
  loadSync (username) {
    const filename = this._findFilename(username)
    return filename != null
      ? this.storage.getJson(filename)
      : { username: fixUsername(username), appId: '' }
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
    const loginId = base64.parse(loginStash.loginId)
    if (loginStash.appId == null) {
      throw new Error('Cannot save a login without an appId.')
    }
    if (loginId.length !== 32) {
      throw new Error('Invalid loginId')
    }
    const filename = base58.stringify(loginId)
    this.storage.setJson(filename, loginStash)
  }

  update (loginId, loginStash) {
    if (loginId.length !== 32) {
      throw new Error('Invalid loginId')
    }
    const filename = base58.stringify(loginId)
    const old = this.storage.getJson(filename)
    const out = old != null ? objectAssign(old, loginStash) : loginStash
    out.loginId = base64.stringify(loginId)
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

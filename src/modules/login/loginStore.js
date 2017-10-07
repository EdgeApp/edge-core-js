// @flow
import { mapFiles } from 'disklet'
import type { FixedIo } from '../../io/fixIo.js'
import { base58, base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { scrypt, userIdSnrp } from '../selectors.js'
import type { LoginStash } from './login-types.js'

function getJsonFiles (folder) {
  return mapFiles(folder, file =>
    file
      .getText()
      .then(text => ({ file, json: JSON.parse(text) }))
      .catch(e => void 0)
  ).then(files => files.filter(file => file != null))
}

function findUserFile (folder, username) {
  const fixedName = fixUsername(username)
  return getJsonFiles(folder).then(files =>
    files.find(file => file.json.username === fixedName)
  )
}

/**
 * Handles login data storage.
 */
export class LoginStore {
  folder: $PropertyType<FixedIo, 'folder'>

  constructor (io: FixedIo) {
    this.folder = io.folder.folder('logins')
  }

  /**
   * Lists the usernames that have data in the store.
   */
  listUsernames () {
    return getJsonFiles(this.folder).then(files =>
      files.map(file => file.json.username)
    )
  }

  /**
   * Finds the login stash for the given username.
   * Returns a default object if
   */
  load (username: string) {
    return findUserFile(this.folder, username).then(
      file =>
        file != null
          ? file.json
          : { username: fixUsername(username), appId: '' }
    )
  }

  /**
   * Removes any login stash that may be stored for the given username.
   */
  remove (username: string) {
    return findUserFile(this.folder, username).then(
      file => (file != null ? file.file.delete() : void 0)
    )
  }

  /**
   * Saves a login stash tree to the folder.
   */
  save (stashTree: LoginStash) {
    const loginId = base64.parse(stashTree.loginId)
    if (stashTree.appId !== '') {
      throw new Error('Cannot save a login without an appId.')
    }
    if (loginId.length !== 32) {
      throw new Error('Invalid loginId')
    }
    const filename = base58.stringify(loginId) + '.json'
    return this.folder.file(filename).setText(JSON.stringify(stashTree))
  }
}

/**
 * Normalizes a username, and checks for invalid characters.
 * TODO: Support a wider character range via Unicode normalization.
 */
export function fixUsername (username: string) {
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
export function hashUsername (ai: ApiInput, username: string) {
  const { state } = ai.props
  const fixedName = fixUsername(username)
  if (userIdCache[fixedName] == null) {
    userIdCache[fixedName] = scrypt(state, fixedName, userIdSnrp)
  }
  return userIdCache[fixedName]
}

import { scrypt, userIdSnrp } from '../crypto/scrypt.js'
import { updateTree } from '../login/login.js'
import { base58, base64 } from '../util/encoding.js'
import { mapFiles } from 'disklet'

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
  constructor (io) {
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
  load (username) {
    return findUserFile(this.folder, username).then(
      file =>
        (file != null
          ? file.json
          : { username: fixUsername(username), appId: '' })
    )
  }

  /**
   * Removes any login stash that may be stored for the given username.
   */
  remove (username) {
    return findUserFile(this.folder, username).then(
      file => (file != null ? file.file.delete() : void 0)
    )
  }

  /**
   * Saves a login stash tree to the folder.
   */
  save (stashTree) {
    const loginId = base64.parse(stashTree.loginId)
    if (stashTree.appId == null) {
      throw new Error('Cannot save a login without an appId.')
    }
    if (loginId.length !== 32) {
      throw new Error('Invalid loginId')
    }
    const filename = base58.stringify(loginId) + '.json'
    return this.folder.file(filename).setText(JSON.stringify(stashTree))
  }

  /**
   * Updates the selected login stash.
   * The `rootLogin` gives the root of the search,
   * and the `targetLogin` gives the node to update.
   * The `update` callback is called on the selected node,
   * and can make any modifications it likes.
   */
  update (rootLogin, targetLogin, update) {
    return this.load(rootLogin.username).then(stashTree => {
      if (stashTree.loginId == null) {
        throw new Error(`Could not load stash for "${rootLogin.username}"`)
      }

      // Update the stash:
      const target = base64.stringify(targetLogin.loginId)
      const newStash = updateTree(
        stashTree,
        (stash, newChildren) => {
          stash.children = newChildren
          return stash
        },
        stash => stash.loginId === target,
        update
      )

      // Save:
      return this.save(newStash)
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

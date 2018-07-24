// @flow

import { mapFiles } from 'disklet'

import type {
  DiskletFile,
  DiskletFolder,
  EdgeIo
} from '../../edge-core-index.js'
import { base58, base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors.js'
import type { LoginStash } from './login-types.js'

export type LoginIdMap = { [loginId: string]: string }

export type FileInfo = {
  file: DiskletFile,
  json: Object
}

function getJsonFiles (folder: DiskletFolder): Promise<Array<FileInfo>> {
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
  folder: $PropertyType<EdgeIo, 'folder'>

  constructor (io: EdgeIo) {
    this.folder = io.folder.folder('logins')
  }

  /**
   * Lists the usernames that have data in the store.
   */
  listUsernames (): Promise<Array<string>> {
    return getJsonFiles(this.folder).then(files =>
      files.map(file => file.json.username)
    )
  }

  /**
   * Creates a map from loginIds to usernames.
   */
  mapLoginIds (): Promise<LoginIdMap> {
    return getJsonFiles(this.folder).then(files => {
      const out: LoginIdMap = {}
      for (const file of files) {
        out[file.json.loginId] = file.json.username
      }
      return out
    })
  }

  /**
   * Finds the login stash for the given username.
   * Returns a default object if
   */
  load (username: string): Promise<LoginStash> {
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
  remove (username: string): Promise<mixed> {
    return findUserFile(this.folder, username).then(
      file => (file != null ? file.file.delete() : void 0)
    )
  }

  /**
   * Saves a login stash tree to the folder.
   */
  save (stashTree: LoginStash) {
    if (stashTree.appId !== '') {
      throw new Error('Cannot save a login without an appId.')
    }
    if (!stashTree.loginId) {
      throw new Error('Cannot save a login without a loginId.')
    }
    const loginId = base64.parse(stashTree.loginId)
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
export function hashUsername (
  ai: ApiInput,
  username: string
): Promise<Uint8Array> {
  const fixedName = fixUsername(username)
  if (userIdCache[fixedName] == null) {
    userIdCache[fixedName] = scrypt(ai, fixedName, userIdSnrp)
  }
  return userIdCache[fixedName]
}

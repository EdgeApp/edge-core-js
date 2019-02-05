// @flow

import { fixUsername } from '../../client-side.js'
import { type ApiInput } from '../root-pixie.js'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors.js'
import { type LoginStash } from './login-types.js'

export { fixUsername }

/**
 * Finds the login stash for the given username.
 * Returns a default object if
 */
export function getStash (ai: ApiInput, username: string): LoginStash {
  const fixedName = fixUsername(username)
  const { stashes } = ai.props.state.login

  return stashes[fixedName] || { username: fixedName, appId: '' }
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

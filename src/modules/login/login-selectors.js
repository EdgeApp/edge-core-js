// @flow

import type { ApiInput } from '../root.js'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors.js'
import type { LoginStash } from './login-types.js'

/**
 * Normalizes a username, and checks for invalid characters.
 * TODO: Support a wider character range via Unicode normalization.
 */
export function fixUsername (username: string): string {
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

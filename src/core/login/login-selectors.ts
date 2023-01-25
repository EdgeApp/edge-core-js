import { base64 } from 'rfc4648'

import { fixUsername } from '../../client-side'
import { verifyData } from '../../util/crypto/verify'
import { ApiInput } from '../root-pixie'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors'
import { searchTree } from './login'
import { LoginStash } from './login-stash'
import { StashLeaf } from './login-types'

export { fixUsername }

/**
 * Finds the login stash for the given username.
 * Returns a default object if
 */
export function getStash(ai: ApiInput, username: string): LoginStash {
  const fixedName = fixUsername(username)
  const { stashes } = ai.props.state.login

  if (stashes[fixedName] != null) return stashes[fixedName]
  return {
    username: fixedName,
    appId: '',
    loginId: new Uint8Array(0),
    pendingVouchers: []
  }
}

export function getStashById(ai: ApiInput, loginId: Uint8Array): StashLeaf {
  const { stashes } = ai.props.state.login
  for (const username of Object.keys(stashes)) {
    const stashTree = stashes[username]
    const stash = searchTree(stashTree, stash =>
      verifyData(stash.loginId, loginId)
    )
    if (stash != null) return { stashTree, stash }
  }
  throw new Error(`Cannot find stash ${base64.stringify(loginId)}`)
}

// Hashed username cache:
const userIdCache: { [username: string]: Promise<Uint8Array> } = {}

/**
 * Hashes a username into a userId.
 */
export function hashUsername(
  ai: ApiInput,
  username: string
): Promise<Uint8Array> {
  const fixedName = fixUsername(username)
  if (userIdCache[fixedName] == null) {
    userIdCache[fixedName] = scrypt(ai, fixedName, userIdSnrp)
  }
  return userIdCache[fixedName]
}

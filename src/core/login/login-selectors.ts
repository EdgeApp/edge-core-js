import { base64 } from 'rfc4648'

import { verifyData } from '../../util/crypto/verify'
import { ApiInput } from '../root-pixie'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors'
import { searchTree } from './login'
import { LoginStash } from './login-stash'
import { StashLeaf } from './login-types'

/**
 * Finds the login stash for the given username.
 * Returns a default object if
 */
export function getStashByUsername(ai: ApiInput, username: string): LoginStash {
  const { stashes } = ai.props.state.login

  if (stashes[username] != null) return stashes[username]
  return {
    username,
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
  if (userIdCache[username] == null) {
    userIdCache[username] = scrypt(ai, username, userIdSnrp)
  }
  return userIdCache[username]
}

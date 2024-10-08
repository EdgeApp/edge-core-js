import { base64 } from 'rfc4648'

import { verifyData } from '../../util/crypto/verify'
import { ApiInput } from '../root-pixie'
import { scrypt, userIdSnrp } from '../scrypt/scrypt-selectors'
import { searchTree } from './login'
import { LoginStash } from './login-stash'
import { StashLeaf } from './login-types'

export function getEmptyStash(username?: string): LoginStash {
  return {
    username,
    appId: '',
    loginId: new Uint8Array(0),
    pendingVouchers: []
  }
}

/**
 * Finds the login stash for the given username.
 */
export function getStashByUsername(
  ai: ApiInput,
  username: string
): LoginStash | undefined {
  const { stashes } = ai.props.state.login
  for (const stash of stashes) {
    if (stash.username === username) return stash
  }
}

export function getStashById(ai: ApiInput, loginId: Uint8Array): StashLeaf {
  const { stashes } = ai.props.state.login
  for (const stashTree of stashes) {
    const stash = searchTree(stashTree, stash =>
      verifyData(stash.loginId, loginId)
    )
    if (stash != null) return { stashTree, stash }
  }
  throw new Error(`Cannot find stash '${base64.stringify(loginId)}'`)
}

export function getChildStash(
  stashTree: LoginStash,
  loginId: Uint8Array
): LoginStash {
  const stash = searchTree(stashTree, stash =>
    verifyData(stash.loginId, loginId)
  )
  if (stash != null) return stash
  throw new Error(`Cannot find child stash '${base64.stringify(loginId)}'`)
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

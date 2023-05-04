import { uncleaner } from 'cleaners'

import { ChangeUsernameOptions } from '../../browser'
import { asChangeUsernamePayload } from '../../types/server-cleaners'
import { encrypt } from '../../util/crypto/crypto'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import { applyKits } from './login'
import { hashUsername } from './login-selectors'
import { LoginKit, LoginTree } from './login-types'
import { makePasswordKit } from './password'
import { makeChangePin2IdKit } from './pin2'
import { makeChangeRecovery2IdKit } from './recovery2'

const wasChangeUsernamePayload = uncleaner(asChangeUsernamePayload)

export async function changeUsername(
  ai: ApiInput,
  accountId: string,
  opts: ChangeUsernameOptions
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  function makeKits(login: LoginTree): Array<Promise<LoginKit | undefined>> {
    const out = [makeChangeUsernameKit(ai, login, opts)]
    for (const child of login.children) {
      out.push(...makeKits(child))
    }
    return out
  }

  const kits = await Promise.all(makeKits(loginTree))
  await applyKits(ai, loginTree, kits)
}

/**
 * Figures out which changes are needed to change a username,
 * and combines the necessary kits.
 */
export async function makeChangeUsernameKit(
  ai: ApiInput,
  login: LoginTree,
  opts: ChangeUsernameOptions
): Promise<LoginKit | undefined> {
  const { password, username } = opts
  const { isRoot, loginId, passwordAuth } = login

  // Validate our input:
  if (passwordAuth != null && password == null) {
    throw new Error('A password is required to change the username')
  }

  const pin2Kit = makeChangePin2IdKit(login, username)
  const recovery2Kit = makeChangeRecovery2IdKit(login, username)
  let passwordKit: LoginKit | undefined
  let usernameKit: LoginKit | undefined

  if (password != null) {
    passwordKit = await makePasswordKit(ai, login, username, password)
  }
  if (isRoot) {
    usernameKit = await makeUsernameKit(ai, login, username)
  }

  // Stop if we have no changes:
  if (
    passwordKit == null &&
    pin2Kit == null &&
    recovery2Kit == null &&
    usernameKit == null
  ) {
    return
  }

  return {
    login: {
      ...passwordKit?.login,
      ...pin2Kit?.login,
      ...recovery2Kit?.login,
      ...usernameKit?.login
    },
    loginId,
    server: {
      ...passwordKit?.server,
      ...pin2Kit?.server,
      ...recovery2Kit?.server,
      ...usernameKit?.server
    },
    serverPath: '',
    stash: {
      ...passwordKit?.stash,
      ...pin2Kit?.stash,
      ...recovery2Kit?.stash,
      ...usernameKit?.stash
    }
  }
}

/**
 * Creates the values needed to set up a username.
 * This is only useful for root logins.
 */
export async function makeUsernameKit(
  ai: ApiInput,
  login: LoginTree,
  username: string
): Promise<LoginKit> {
  const { io } = ai.props
  const { loginId, loginKey } = login

  const userId = await hashUsername(ai, username)

  return {
    login: { userId, username },
    loginId,
    server: wasChangeUsernamePayload({
      userId,
      userTextBox: encrypt(io, utf8.parse(username), loginKey)
    }),
    serverPath: '',
    stash: { userId, username }
  }
}

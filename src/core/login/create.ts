import { wasCreateLoginPayload } from '../../types/server-cleaners'
import { EdgeBox } from '../../types/server-types'
import {
  asMaybeUsernameError,
  EdgeAccountOptions,
  EdgeWalletInfo
} from '../../types/types'
import { encrypt } from '../../util/crypto/crypto'
import { ApiInput } from '../root-pixie'
import { makeKeysKit } from './keys'
import { loginFetch } from './login-fetch'
import { makeSecretKit } from './login-secret'
import { hashUsername } from './login-selectors'
import { LoginStash, saveStash } from './login-stash'
import { LoginKit, LoginTree, SessionKey } from './login-types'
import { makeUsernameKit } from './login-username'
import { makePasswordKit } from './password'
import { makeChangePin2Kit } from './pin2'

export interface LoginCreateOpts {
  keyInfo?: EdgeWalletInfo
  password?: string
  pin?: string
  username?: string
}

/**
 * Determines whether or not a username is available.
 */
export async function usernameAvailable(
  ai: ApiInput,
  username: string,
  challengeId?: string
): Promise<boolean> {
  const userId = await hashUsername(ai, username)
  const request = {
    challengeId,
    userId
  }
  return await loginFetch(ai, 'POST', '/v2/login', request)
    .then(reply => false) // It's not available if we can hit it!
    .catch((error: unknown) => {
      if (asMaybeUsernameError(error) != null) return true
      throw error
    })
}

/**
 * Assembles all the data needed to create a new login.
 */
export async function makeCreateKit(
  ai: ApiInput,
  parentSessionKey: SessionKey | undefined,
  appId: string,
  opts: LoginCreateOpts
): Promise<{ kit: LoginKit; sessionKey: SessionKey }> {
  const { keyInfo, password, pin, username } = opts
  const { io } = ai.props

  // For crash errors:
  ai.props.log.breadcrumb('makeCreateKit', {})

  // Figure out login identity:
  const isRoot = parentSessionKey == null
  const loginId = io.random(32)
  const loginKey = io.random(32)
  const sessionKey = { loginId, loginKey }

  // Create the basic login object, but without any authentication methods:
  const login: LoginTree = {
    appId,
    lastLogin: new Date(),
    loginId,
    loginKey,
    isRoot,
    pendingVouchers: [],
    children: []
  }

  const secretKit = makeSecretKit(ai, login)
  let keysKit: LoginKit | undefined
  let parentBox: EdgeBox | undefined
  let passwordKit: LoginKit | undefined
  let pin2Kit: LoginKit | undefined
  let usernameKit: LoginKit | undefined

  // Set up optional login methods:
  if (keyInfo != null) {
    keysKit = makeKeysKit(ai, sessionKey, [keyInfo])
  }
  if (parentSessionKey != null) {
    parentBox = encrypt(io, loginKey, parentSessionKey.loginKey)
  }
  if (password != null && username != null) {
    passwordKit = await makePasswordKit(ai, login, username, password)
  }
  if (pin != null) {
    pin2Kit = makeChangePin2Kit(ai, login, username, pin, true)
  }
  if (isRoot && username != null) {
    usernameKit = await makeUsernameKit(ai, login, username)
  }

  // Bundle everything:
  const kit: LoginKit = {
    loginId,
    server: {
      ...wasCreateLoginPayload({
        appId,
        loginId,
        parentBox
      }),
      ...keysKit?.server,
      ...passwordKit?.server,
      ...pin2Kit?.server,
      ...secretKit.server,
      ...usernameKit?.server
    },
    serverPath: '/v2/login/create',
    stash: {
      appId,
      loginId,
      parentBox,
      ...keysKit?.stash,
      ...passwordKit?.stash,
      ...pin2Kit?.stash,
      ...secretKit.stash,
      ...usernameKit?.stash
    }
  }
  return { kit, sessionKey }
}

/**
 * Creates a new login on the auth server.
 */
export async function createLogin(
  ai: ApiInput,
  accountOpts: EdgeAccountOptions,
  opts: LoginCreateOpts
): Promise<SessionKey> {
  const { challengeId, now = new Date() } = accountOpts

  // For crash errors:
  ai.props.log.breadcrumb('createLogin', {})

  const { kit, sessionKey } = await makeCreateKit(ai, undefined, '', opts)
  const request = { challengeId, data: kit.server }
  await loginFetch(ai, 'POST', kit.serverPath, request)

  kit.stash.lastLogin = now
  await saveStash(ai, kit.stash as LoginStash)
  return sessionKey
}

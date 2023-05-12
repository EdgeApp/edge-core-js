import { uncleaner } from 'cleaners'

import { asCreateLoginPayload } from '../../types/server-cleaners'
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
import { LoginKit, LoginTree } from './login-types'
import { makeUsernameKit } from './login-username'
import { makePasswordKit } from './password'
import { makeChangePin2Kit } from './pin2'

const wasCreateLoginPayload = uncleaner(asCreateLoginPayload)

export interface LoginCreateOpts {
  keyInfo?: EdgeWalletInfo
  password?: string | undefined
  pin?: string | undefined
}

/**
 * Determines whether or not a username is available.
 */
export async function usernameAvailable(
  ai: ApiInput,
  username: string
): Promise<boolean> {
  const userId = await hashUsername(ai, username)
  const request = {
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
  parentLogin: LoginTree | undefined,
  appId: string,
  username: string,
  opts: LoginCreateOpts
): Promise<LoginKit> {
  const { keyInfo, password, pin } = opts
  const { io } = ai.props

  // Figure out login identity:
  const loginId = io.random(32)
  const loginKey = io.random(32)

  // Create the basic login object, but without any authentication methods:
  const login: LoginTree = {
    appId,
    lastLogin: new Date(),
    loginId,
    loginKey,
    pendingVouchers: [],
    children: [],
    keyInfos: []
  }

  const secretKit = makeSecretKit(ai, login)
  let keysKit: LoginKit | undefined
  let parentBox: EdgeBox | undefined
  let passwordKit: LoginKit | undefined
  let pin2Kit: LoginKit | undefined
  let usernameKit: LoginKit | undefined

  // Set up optional login methods:
  if (keyInfo != null) {
    keysKit = makeKeysKit(ai, login, keyInfo)
  }
  if (parentLogin != null) {
    parentBox = encrypt(io, loginKey, parentLogin.loginKey)
  }
  if (password != null) {
    passwordKit = await makePasswordKit(ai, login, username, password)
  }
  if (pin != null) {
    pin2Kit = makeChangePin2Kit(ai, login, username, pin, true)
  }
  if (parentLogin == null) {
    usernameKit = await makeUsernameKit(ai, login, username)
  }

  // Bundle everything:
  return {
    loginId,
    serverPath: '/v2/login/create',
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
    stash: {
      appId,
      loginId,
      parentBox,
      ...keysKit?.stash,
      ...passwordKit?.stash,
      ...pin2Kit?.stash,
      ...secretKit.stash,
      ...usernameKit?.stash
    },
    login: {
      appId,
      loginId,
      loginKey,
      keyInfos: [],
      ...keysKit?.login,
      ...passwordKit?.login,
      ...pin2Kit?.login,
      ...secretKit.login,
      ...usernameKit?.login
    }
  }
}

/**
 * Creates a new login on the auth server.
 */
export async function createLogin(
  ai: ApiInput,
  username: string,
  accountOpts: EdgeAccountOptions,
  opts: LoginCreateOpts
): Promise<LoginTree> {
  const { now = new Date() } = accountOpts

  const kit = await makeCreateKit(ai, undefined, '', username, opts)
  const request = { data: kit.server }
  await loginFetch(ai, 'POST', kit.serverPath, request)

  kit.stash.lastLogin = now
  await saveStash(ai, kit.stash as LoginStash)
  return kit.login as LoginTree
}

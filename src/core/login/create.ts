import { uncleaner } from 'cleaners'

import {
  asChangeSecretPayload,
  asCreateLoginPayload
} from '../../types/server-cleaners'
import {
  asMaybeUsernameError,
  EdgeAccountOptions,
  EdgeWalletInfo
} from '../../types/types'
import { encrypt } from '../../util/crypto/crypto'
import { ApiInput } from '../root-pixie'
import { makeKeysKit } from './keys'
import { loginFetch } from './login-fetch'
import { fixUsername, hashUsername } from './login-selectors'
import { saveStash } from './login-stash'
import { LoginKit, LoginTree } from './login-types'
import { makeUsernameKit } from './login-username'
import { makePasswordKit } from './password'
import { makeChangePin2Kit } from './pin2'

const wasChangeSecretPayload = uncleaner(asChangeSecretPayload)
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
  const { io } = ai.props

  // Figure out login identity:
  const loginId = io.random(32)
  const loginKey = io.random(32)

  const dummyLogin: LoginTree = {
    appId,
    lastLogin: new Date(),
    loginId,
    loginKey,
    pendingVouchers: [],
    children: [],
    keyInfos: []
  }
  const dummyKit: LoginKit = {
    login: {},
    loginId,
    serverPath: '/v2/login',
    stash: {}
  }

  // Set up login methods:
  const parentBox =
    parentLogin != null
      ? encrypt(io, loginKey, parentLogin.loginKey)
      : undefined
  const passwordKit: LoginKit =
    opts.password != null
      ? await makePasswordKit(ai, dummyLogin, username, opts.password)
      : dummyKit
  const pin2Kit: LoginKit =
    opts.pin != null
      ? makeChangePin2Kit(ai, dummyLogin, username, opts.pin, true)
      : dummyKit
  const keysKit: LoginKit =
    opts.keyInfo != null ? makeKeysKit(ai, dummyLogin, opts.keyInfo) : dummyKit

  // Secret-key login:
  const loginAuth = io.random(32)
  const loginAuthBox = encrypt(io, loginAuth, loginKey)
  const secretServer = wasChangeSecretPayload({
    loginAuth,
    loginAuthBox
  })

  // Top-level username:
  const usernameKit: LoginKit =
    parentLogin == null
      ? await makeUsernameKit(ai, dummyLogin, username)
      : dummyKit

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
      ...keysKit.server,
      ...passwordKit.server,
      ...pin2Kit.server,
      ...secretServer,
      ...usernameKit.server
    },
    stash: {
      appId,
      loginAuthBox,
      loginId,
      parentBox,
      ...passwordKit.stash,
      ...pin2Kit.stash,
      ...keysKit.stash,
      ...usernameKit.stash
    },
    login: {
      appId,
      loginAuth,
      loginId,
      loginKey,
      keyInfos: [],
      ...passwordKit.login,
      ...pin2Kit.login,
      ...keysKit.login,
      ...usernameKit.login
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
  const fixedName = fixUsername(username)
  const { now = new Date() } = accountOpts

  const kit = await makeCreateKit(ai, undefined, '', fixedName, opts)
  const request = { data: kit.server }
  await loginFetch(ai, 'POST', kit.serverPath, request)

  kit.stash.lastLogin = now
  await saveStash(ai, kit.stash)
  return kit.login
}

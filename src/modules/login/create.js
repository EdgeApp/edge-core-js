// @flow
import { UsernameError } from '../../error.js'
import { encrypt } from '../../util/crypto/crypto.js'
import { base64 } from '../../util/encoding.js'
import type { CoreRoot } from '../root.js'
import { makeKeysKit } from './keys.js'
import type { LoginKit, LoginTree, WalletInfo } from './login-types.js'
import { fixUsername, hashUsername } from './loginStore.js'
import { makePasswordKit } from './password.js'
import { makePin2Kit } from './pin2.js'

export interface LoginCreateOpts {
  keyInfo?: WalletInfo<{}>,
  password?: string | void,
  pin?: string | void
}

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (coreRoot: CoreRoot, username: string) {
  return hashUsername(coreRoot, username).then(userId => {
    const request = {
      userId: base64.stringify(userId)
    }
    return coreRoot
      .authRequest('POST', '/v2/login', request)
      .then(reply => false) // It's not available if we can hit it!
      .catch(e => {
        if (e.type !== UsernameError.type) {
          throw e
        }
        return true
      })
  })
}

/**
 * Assembles all the data needed to create a new login.
 */
export function makeCreateKit (
  coreRoot: CoreRoot,
  parentLogin?: LoginTree,
  appId: string,
  username: string,
  opts: LoginCreateOpts
): Promise<LoginKit> {
  // Figure out login identity:
  const loginId =
    parentLogin != null
      ? coreRoot.io.random(32)
      : hashUsername(coreRoot, username)
  const loginKey = coreRoot.io.random(32)
  const loginAuth = coreRoot.io.random(32)
  const loginAuthBox = encrypt(coreRoot.io, loginAuth, loginKey)

  // Set up login methods:
  const parentBox =
    parentLogin != null
      ? encrypt(coreRoot.io, loginKey, parentLogin.loginKey)
      : void 0
  const passwordKit =
    opts.password != null
      ? makePasswordKit(coreRoot, { loginKey }, username, opts.password)
      : {}
  const pin2Kit =
    opts.pin != null
      ? makePin2Kit(coreRoot, { loginKey }, username, opts.pin)
      : {}
  const keysKit =
    opts.keyInfo != null
      ? makeKeysKit(coreRoot, { loginKey }, opts.keyInfo)
      : {}

  // Bundle everything:
  return Promise.all([loginId, passwordKit]).then(values => {
    const [loginId, passwordKit] = values
    return {
      serverPath: '/v2/login/create',
      server: {
        appId,
        loginAuth: base64.stringify(loginAuth),
        loginAuthBox,
        loginId: base64.stringify(loginId),
        parentBox,
        ...passwordKit.server,
        ...pin2Kit.server,
        ...keysKit.server
      },
      stash: {
        appId,
        loginAuthBox,
        loginId: base64.stringify(loginId),
        parentBox,
        ...passwordKit.stash,
        ...pin2Kit.stash,
        ...keysKit.stash
      },
      login: {
        appId,
        loginAuth,
        loginId: base64.stringify(loginId),
        loginKey,
        keyInfos: [],
        ...passwordKit.login,
        ...pin2Kit.login,
        ...keysKit.login
      }
    }
  })
}

/**
 * Creates a new login on the auth server.
 */
export function createLogin (
  coreRoot: CoreRoot,
  username: string,
  opts: LoginCreateOpts
): Promise<LoginTree> {
  const fixedName = fixUsername(username)

  return makeCreateKit(coreRoot, void 0, '', fixedName, opts).then(kit => {
    kit.login.username = fixedName
    kit.stash.username = fixedName
    kit.login.userId = kit.login.loginId

    const request = {}
    request.data = kit.server
    return coreRoot
      .authRequest('POST', kit.serverPath, request)
      .then(reply => coreRoot.loginStore.save(kit.stash).then(() => kit.login))
  })
}

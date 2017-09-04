import { encrypt } from '../crypto/crypto.js'
import { UsernameError } from '../error.js'
import { fixUsername, hashUsername } from '../io/loginStore.js'
import { base64 } from '../util/encoding.js'
import { makeKeysKit } from './keys.js'
import { makePasswordKit } from './password.js'
import { makePin2Kit } from './pin2.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (io, username) {
  return hashUsername(io, username).then(userId => {
    const request = {
      userId: base64.stringify(userId)
    }
    return io
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
export function makeCreateKit (io, parentLogin, appId, username, opts) {
  // Figure out login identity:
  const loginId =
    parentLogin != null ? io.random(32) : hashUsername(io, username)
  const loginKey = io.random(32)
  const loginAuth = io.random(32)
  const loginAuthBox = encrypt(io, loginAuth, loginKey)

  // Set up login methods:
  const parentBox =
    parentLogin != null ? encrypt(io, loginKey, parentLogin.loginKey) : void 0
  const passwordKit =
    opts.password != null
      ? makePasswordKit(io, { loginKey }, username, opts.password)
      : {}
  const pin2Kit =
    opts.pin != null ? makePin2Kit(io, { loginKey }, username, opts.pin) : {}
  const keysKit =
    opts.keyInfo != null ? makeKeysKit(io, { loginKey }, opts.keyInfo) : {}

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
export function createLogin (io, username, opts) {
  const fixedName = fixUsername(username)

  return makeCreateKit(io, null, '', fixedName, opts).then(kit => {
    kit.login.username = fixedName
    kit.stash.username = fixedName
    kit.login.userId = kit.login.loginId

    const request = {}
    request.data = kit.server
    return io
      .authRequest('POST', kit.serverPath, request)
      .then(reply => io.loginStore.save(kit.stash).then(() => kit.login))
  })
}

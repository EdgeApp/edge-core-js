import { encrypt } from '../crypto/crypto.js'
import { UsernameError } from '../error.js'
import { fixUsername, hashUsername } from '../io/loginStore.js'
import { base64 } from '../util/encoding.js'
import { objectAssign } from '../util/util.js'
import { makeAuthJson, makeKeysKit } from './login.js'
import { makePasswordKit } from './password.js'
import { makePin2Kit } from './pin2.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (io, username) {
  return hashUsername(username).then(userId => {
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
export function makeNewKit (io, parentLogin, appId, username, opts) {
  // Figure out login identity:
  const loginId = parentLogin != null ? io.random(32) : hashUsername(username)
  const loginKey = io.random(32)
  const loginAuth = io.random(32)
  const loginAuthBox = encrypt(io, loginAuth, loginKey)

  // Set up login methods:
  const parentBox = parentLogin != null
    ? encrypt(io, loginKey, parentLogin.loginKey)
    : null
  const passwordKit = opts.password != null
    ? makePasswordKit(io, { loginKey }, username, opts.password)
    : {}
  const pin2Kit = opts.pin != null
    ? makePin2Kit(io, { loginKey }, username, opts.pin)
    : {}
  const keysKit = opts.keyInfos != null
    ? makeKeysKit(io, { loginKey }, opts.keyInfos, opts.newSyncKeys)
    : {}

  // Bundle everything:
  return Promise.all([loginId, passwordKit]).then(values => {
    const [loginId, passwordKit] = values
    return {
      server: objectAssign(
        {
          appId,
          loginId: base64.stringify(loginId),
          loginAuth: base64.stringify(loginAuth),
          loginAuthBox,
          parentBox
        },
        passwordKit.server,
        pin2Kit.server,
        keysKit.server
      ),
      stash: objectAssign(
        {
          appId,
          loginId: base64.stringify(loginId),
          loginAuthBox,
          parentBox,
          keyBoxes: [],
          children: []
        },
        passwordKit.stash,
        pin2Kit.stash,
        keysKit.stash
      ),
      login: objectAssign(
        {
          loginKey,
          appId,
          loginId,
          loginAuth,
          keyInfos: [],
          children: []
        },
        passwordKit.login,
        pin2Kit.login,
        keysKit.login
      )
    }
  })
}

/**
 * Creates a new login on the auth server.
 */
export function createLogin (io, username, opts) {
  const fixedName = fixUsername(username)

  return makeNewKit(io, null, '', fixedName, opts).then(kit => {
    const request = {}
    request.data = kit.server
    return io.authRequest('POST', '/v2/login/create', request).then(reply => {
      kit.login.username = fixedName
      kit.stash.username = fixedName
      kit.login.userId = kit.login.loginId
      io.loginStore.save(kit.stash)

      return kit.login
    })
  })
}

/**
 * Creates a new child login on the auth server.
 */
export function createChildLogin (io, rootLogin, parentLogin, appId, opts) {
  return makeNewKit(
    io,
    parentLogin,
    appId,
    rootLogin.username,
    opts
  ).then(kit => {
    const request = makeAuthJson(parentLogin)
    request.data = kit.server
    return io.authRequest('POST', '/v2/login/create', request).then(reply => {
      parentLogin.children.push(kit.login)
      return io.loginStore
        .update(rootLogin, parentLogin, stash => {
          stash.children.push(kit.stash)
          return stash
        })
        .then(() => kit.login)
    })
  })
}

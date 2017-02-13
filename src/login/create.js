import * as crypto from '../crypto/crypto.js'
import { fixUsername, hashUsername } from '../io/loginStore.js'
import {base16, base64} from '../util/encoding.js'
import { objectAssign } from '../util/util.js'
import { makeAuthJson, makeLogin } from './login.js'
import { makePasswordKit } from './password.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (io, username) {
  return hashUsername(username).then(userId => {
    const request = {
      'l1': base64.stringify(userId)
    }
    return io.authRequest('POST', '/v1/account/available', request)
  })
}

/**
 * Creates a new login on the auth server.
 */
export function create (io, username, password, opts) {
  // Create account repo info:
  const loginKey = io.random(32)
  const syncKey = io.random(20)
  const syncKeyBox = crypto.encrypt(io, syncKey, loginKey)

  return Promise.all([
    hashUsername(username),
    makePasswordKit(io, { loginKey }, username, password)
  ]).then(values => {
    const [userId, passwordKit] = values

    // Package:
    const carePackage = {
      'SNRP2': passwordKit.server.passwordKeySnrp
    }
    const loginPackage = {
      'EMK_LP2': passwordKit.server.passwordBox,
      'ESyncKey': syncKeyBox,
      'ELP1': passwordKit.server.passwordAuthBox
    }
    const request = {
      'l1': base64.stringify(userId),
      'lp1': passwordKit.server.passwordAuth,
      'care_package': JSON.stringify(carePackage),
      'login_package': JSON.stringify(loginPackage),
      'repo_account_key': base16.stringify(syncKey)
    }
    const loginStash = objectAssign(
      {
        username: fixUsername(username),
        appId: '',
        userId: base64.stringify(userId),
        syncKeyBox,
        keyBoxes: []
      },
      passwordKit.stash
    )

    return io.authRequest('POST', '/v1/account/create', request).then(reply => {
      // Cache everything for future logins:
      io.loginStore.save(loginStash)

      const login = makeLogin(loginStash, loginKey)

      // Now activate:
      const auth = makeAuthJson(login)
      const request = {
        l1: auth.userId,
        lp1: auth.passwordAuth
      }
      return io.authRequest('POST', '/v1/account/activate', request).then(reply => login)
    })
  })
}

import * as crypto from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import {base16, base64} from '../util/encoding.js'
import {mergeObjects} from '../util/util.js'
import {Login} from './login.js'
import * as passwordLogin from './password.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (io, username) {
  return io.loginStore.getUserId(username).then(userId => {
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
  const dataKey = io.random(32)
  const syncKey = opts.syncKey || io.random(20)
  const syncKeyBox = crypto.encrypt(io, syncKey, dataKey)

  return Promise.all([
    io.loginStore.getUserId(username),
    passwordLogin.makeSetup(io, dataKey, username, password)
  ]).then(values => {
    const [userId, passwordSetup] = values

    // Package:
    const carePackage = {
      'SNRP2': passwordSetup.server.passwordKeySnrp
    }
    const loginPackage = {
      'EMK_LP2': passwordSetup.server.passwordBox,
      'ESyncKey': syncKeyBox,
      'ELP1': passwordSetup.server.passwordAuthBox
    }
    const request = {
      'l1': base64.stringify(userId),
      'lp1': passwordSetup.server.passwordAuth,
      'care_package': JSON.stringify(carePackage),
      'login_package': JSON.stringify(loginPackage),
      'repo_account_key': base16.stringify(syncKey)
    }
    const loginData = mergeObjects({
      username: fixUsername(username), syncKeyBox
    }, passwordSetup.storage)

    return io.authRequest('POST', '/v1/account/create', request).then(reply => {
      // Cache everything for future logins:
      io.loginStore.update(userId, loginData)

      const login = Login.offline(io, username, userId, dataKey)

      // Now activate:
      const auth = login.authJson()
      const request = {
        l1: auth.userId,
        lp1: auth.passwordAuth
      }
      return io.authRequest('POST', '/v1/account/activate', request).then(reply => login)
    })
  })
}

import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {base16, base64} from '../util/encoding.js'
import {Login} from './login.js'
import * as passwordLogin from './password.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (io, username) {
  username = userMap.normalize(username)

  return userMap.getUserId(io, username).then(userId => {
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
  username = userMap.normalize(username)

  // Create account repo info:
  const dataKey = io.random(32)
  const syncKey = opts.syncKey || io.random(20)
  const syncKeyBox = crypto.encrypt(io, syncKey, dataKey)

  return Promise.all([
    userMap.getUserId(io, username),
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

    return io.authRequest('POST', '/v1/account/create', request).then(reply => {
      // Cache everything for future logins:
      userMap.insert(io, username, userId)
      const userStorage = io.loginStore.findUsername(username)
      userStorage.setItems(passwordSetup.storage)
      userStorage.setJson('syncKeyBox', syncKeyBox)

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

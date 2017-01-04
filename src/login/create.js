import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {UserStorage} from '../userStorage.js'
import {Login} from './login.js'
import * as passwordLogin from './password.js'

/**
 * Determines whether or not a username is available.
 */
export function usernameAvailable (ctx, username) {
  username = userMap.normalize(username)

  return userMap.getUserId(ctx.localStorage, username).then(userId => {
    const request = {
      'l1': userId
    }
    return ctx.authRequest('POST', '/v1/account/available', request)
  })
}

/**
 * Creates a new login on the auth server.
 */
export function create (ctx, username, password, opts) {
  username = userMap.normalize(username)

  // Create account repo info:
  const dataKey = crypto.random(32)
  const syncKey = opts.syncKey || crypto.random(20)
  const syncKeyBox = crypto.encrypt(syncKey, dataKey)

  return Promise.all([
    userMap.getUserId(ctx.localStorage, username),
    passwordLogin.makeSetup(ctx, dataKey, username, password)
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
      'l1': userId,
      'lp1': passwordSetup.server.passwordAuth,
      'care_package': JSON.stringify(carePackage),
      'login_package': JSON.stringify(loginPackage),
      'repo_account_key': syncKey.toString('hex')
    }

    return ctx.authRequest('POST', '/v1/account/create', request).then(reply => {
      // Cache everything for future logins:
      userMap.insert(ctx.localStorage, username, userId)
      const userStorage = new UserStorage(ctx.localStorage, username)
      userStorage.setItems(passwordSetup.storage)
      userStorage.setJson('syncKeyBox', syncKeyBox)

      const login = Login.offline(ctx.localStorage, username, userId, dataKey)

      // Now activate:
      const auth = login.authJson()
      const request = {
        l1: auth.userId,
        lp1: auth.passwordAuth
      }
      return ctx.authRequest('POST', '/v1/account/activate', request).then(reply => login)
    })
  })
}

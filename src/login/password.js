import * as crypto from '../crypto/crypto.js'
import { makeSnrp, passwordAuthSnrp, scrypt } from '../crypto/scrypt.js'
import {fixUsername} from '../io/loginStore.js'
import {rejectify} from '../util/decorators.js'
import {base64} from '../util/encoding.js'
import {
  loginOnline as makeLoginOnline,
  loginOffline as makeLoginOffline,
  makeAuthJson
} from './login.js'

function makeHashInput (username, password) {
  return fixUsername(username) + password
}

function loginOffline (io, loginStash, username, password) {
  // Extract stuff from storage:
  const passwordKeySnrp = loginStash.passwordKeySnrp
  const passwordBox = loginStash.passwordBox
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Missing data for offline login')
  }

  // Decrypt the loginKey:
  const up = makeHashInput(username, password)
  return scrypt(up, passwordKeySnrp).then(passwordKey => {
    const loginKey = crypto.decrypt(passwordBox, passwordKey)
    return makeLoginOffline(io, loginKey, loginStash)
  })
}

function loginOnline (io, username, userId, password) {
  const up = makeHashInput(username, password)
  return scrypt(up, passwordAuthSnrp).then(passwordAuth => {
    // Encode the username:
    const request = {
      'userId': base64.stringify(userId),
      'passwordAuth': base64.stringify(passwordAuth)
      // "otp": null
    }
    return io.authRequest('POST', '/v2/login', request).then(reply => {
      // Password login:
      const passwordKeySnrp = reply['passwordKeySnrp']
      const passwordBox = reply['passwordBox']
      if (!passwordKeySnrp || !passwordBox) {
        throw new Error('Missing data for password login')
      }

      // Decrypt the loginKey:
      return scrypt(up, passwordKeySnrp).then(passwordKey => {
        const loginKey = crypto.decrypt(passwordBox, passwordKey)

        // Build the login object:
        return makeLoginOnline(io, username, userId, loginKey, reply)
      })
    })
  })
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @return `Login` object promise
 */
export function login (io, username, password) {
  return io.loginStore.load(username).then(loginStash => {
    return rejectify(loginOffline)(io, loginStash, username, password).catch(e =>
      loginOnline(io, username, base64.parse(loginStash.userId), password)
    )
  })
}

/**
 * Returns true if the given password is correct.
 */
export function check (io, login, password) {
  // Derive passwordAuth:
  const up = makeHashInput(login.username, password)
  return scrypt(up, passwordAuthSnrp).then(passwordAuth => {
    // Compare what we derived with what we have:
    for (let i = 0; i < passwordAuth.length; ++i) {
      if (passwordAuth[i] !== login.passwordAuth[i]) {
        return false
      }
    }
    return true
  })
}

/**
 * Creates the data needed to attach a password to a login.
 */
export function makePasswordKit (io, login, username, password) {
  const up = makeHashInput(username, password)

  // loginKey chain:
  const boxPromise = makeSnrp(io).then(passwordKeySnrp => {
    return scrypt(up, passwordKeySnrp).then(passwordKey => {
      const passwordBox = crypto.encrypt(io, login.loginKey, passwordKey)
      return { passwordKeySnrp, passwordBox }
    })
  })

  // authKey chain:
  const authPromise = scrypt(up, passwordAuthSnrp).then(passwordAuth => {
    const passwordAuthBox = crypto.encrypt(io, passwordAuth, login.loginKey)
    return { passwordAuth, passwordAuthBox }
  })

  return Promise.all([boxPromise, authPromise]).then(values => {
    const [
      { passwordKeySnrp, passwordBox },
      { passwordAuth, passwordAuthBox }
    ] = values
    return {
      server: {
        passwordAuth: base64.stringify(passwordAuth),
        passwordAuthSnrp, // TODO: Use this on the other side
        passwordKeySnrp,
        passwordBox,
        passwordAuthBox
      },
      stash: {
        passwordKeySnrp,
        passwordBox,
        passwordAuthBox
      },
      login: {
        passwordAuth
      }
    }
  })
}

/**
 * Sets up a password for the login.
 */
export function setup (io, login, password) {
  return makePasswordKit(io, login, login.username, password).then(kit => {
    const request = makeAuthJson(login)
    request.data = kit.server
    return io.authRequest('POST', '/v2/login/password', request).then(reply => {
      io.loginStore.update(login.userId, kit.stash)
      login.passwordAuth = kit.login.passwordAuth
      return login
    })
  })
}

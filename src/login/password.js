import * as crypto from '../crypto/crypto.js'
import * as scrypt from '../crypto/scrypt.js'
import {fixUsername} from '../io/loginStore.js'
import {rejectify} from '../util/decorators.js'
import {base64} from '../util/encoding.js'
import {Login} from './login.js'

function makeHashInput (username, password) {
  return fixUsername(username) + password
}

function loginOffline (io, username, userId, password) {
  // Extract stuff from storage:
  const loginStash = io.loginStore.find({username})
  const passwordKeySnrp = loginStash.passwordKeySnrp
  const passwordBox = loginStash.passwordBox
  if (!passwordKeySnrp || !passwordBox) {
    throw new Error('Missing data for offline login')
  }

  // Decrypt the loginKey:
  const up = makeHashInput(username, password)
  return scrypt.scrypt(up, passwordKeySnrp).then(passwordKey => {
    const loginKey = crypto.decrypt(passwordBox, passwordKey)
    return Login.offline(io, username, userId, loginKey)
  })
}

function loginOnline (io, username, userId, password) {
  const up = makeHashInput(username, password)
  return scrypt.scrypt(up, scrypt.passwordAuthSnrp).then(passwordAuth => {
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
      return scrypt.scrypt(up, passwordKeySnrp).then(passwordKey => {
        const loginKey = crypto.decrypt(passwordBox, passwordKey)

        // Build the login object:
        return Login.online(io, username, userId, loginKey, reply)
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
  return io.loginStore.getUserId(username).then(userId => {
    // Race the two login methods, and let the fastest one win:
    return rejectify(loginOffline)(io, username, userId, password).catch(e =>
      rejectify(loginOnline)(io, username, userId, password)
    )
  })
}

/**
 * Returns true if the given password is correct.
 */
export function check (io, login, password) {
  // Derive passwordAuth:
  return scrypt.scrypt(login.username + password, scrypt.passwordAuthSnrp).then(passwordAuth => {
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
 * Creates the data needed to set up the password on the server.
 */
export function makeSetup (io, loginKey, username, password) {
  const up = makeHashInput(username, password)

  // loginKey chain:
  const boxPromise = scrypt.makeSnrp(io).then(passwordKeySnrp => {
    return scrypt.scrypt(up, passwordKeySnrp).then(passwordKey => {
      const passwordBox = crypto.encrypt(io, loginKey, passwordKey)
      return {passwordKeySnrp, passwordBox}
    })
  })

  // authKey chain:
  const authPromise = scrypt.scrypt(up, scrypt.passwordAuthSnrp).then(passwordAuth => {
    const passwordAuthBox = crypto.encrypt(io, passwordAuth, loginKey)
    return {passwordAuth, passwordAuthBox}
  })

  return Promise.all([boxPromise, authPromise]).then(values => {
    const [
      {passwordKeySnrp, passwordBox},
      {passwordAuth, passwordAuthBox}
    ] = values
    return {
      server: {
        'passwordAuth': base64.stringify(passwordAuth),
        'passwordAuthSnrp': scrypt.passwordAuthSnrp, // TODO: Not needed
        'passwordKeySnrp': passwordKeySnrp,
        'passwordBox': passwordBox,
        'passwordAuthBox': passwordAuthBox
      },
      storage: {
        'passwordKeySnrp': passwordKeySnrp,
        'passwordBox': passwordBox,
        'passwordAuthBox': passwordAuthBox
      },
      passwordAuth
    }
  })
}

/**
 * Sets up a password for the login.
 */
export function setup (io, login, password) {
  return makeSetup(io, login.loginKey, login.username, password).then(setup => {
    const request = login.authJson()
    request['data'] = setup.server
    return io.authRequest('POST', '/v2/login/password', request).then(reply => {
      io.loginStore.update(login.userId, setup.storage)
      login.passwordAuth = setup.passwordAuth
      return null
    })
  })
}

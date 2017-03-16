import * as crypto from '../crypto/crypto.js'
import { makeSnrp, passwordAuthSnrp, scrypt } from '../crypto/scrypt.js'
import {fixUsername} from '../io/loginStore.js'
import {rejectify} from '../util/decorators.js'
import {base64} from '../util/encoding.js'
import { applyLoginReply, makeAuthJson, makeLogin } from './login.js'

function makeHashInput (username, password) {
  return fixUsername(username) + password
}

/**
 * Extracts the loginKey from the loginStash.
 */
function extractLoginKey (loginStash, username, password) {
  if (loginStash.passwordBox == null || loginStash.passwordKeySnrp == null) {
    throw new Error('Missing data for offline password login')
  }
  const up = makeHashInput(username, password)
  return scrypt(up, loginStash.passwordKeySnrp).then(passwordKey => {
    return crypto.decrypt(loginStash.passwordBox, passwordKey)
  })
}

/**
 * Fetches the loginKey from the server.
 */
function fetchLoginKey (io, userId, username, password) {
  const up = makeHashInput(username, password)
  return scrypt(up, passwordAuthSnrp).then(passwordAuth => {
    const request = {
      userId: base64.stringify(userId),
      passwordAuth: base64.stringify(passwordAuth)
      // "otp": null
    }
    return io.authRequest('POST', '/v2/login', request).then(reply => {
      if (reply.passwordBox == null || reply.passwordKeySnrp == null) {
        throw new Error('Missing data for online password login')
      }
      return scrypt(up, reply.passwordKeySnrp).then(passwordKey => {
        return {
          loginKey: crypto.decrypt(reply.passwordBox, passwordKey),
          loginReply: reply
        }
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
    return rejectify(extractLoginKey)(loginStash, username, password)
      .then(loginKey => {
        const login = makeLogin(loginStash, loginKey)

        // Since we logged in offline, update the stash in the background:
        io
          .authRequest('POST', '/v2/login', makeAuthJson(login))
          .then(loginReply => {
            loginStash = applyLoginReply(loginStash, loginKey, loginReply)
            return io.loginStore.save(loginStash)
          })
          .catch(e => io.log.warn(e))

        return login
      })
      .catch(e => {
        // If that failed, try an online login:
        return fetchLoginKey(
          io,
          base64.parse(loginStash.userId),
          username,
          password
        ).then(values => {
          const { loginKey, loginReply } = values
          loginStash = applyLoginReply(loginStash, loginKey, loginReply)
          io.loginStore.save(loginStash)
          return makeLogin(loginStash, loginKey)
        })
      })
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

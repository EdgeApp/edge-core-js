// @flow

import { decrypt, encrypt } from '../../util/crypto/crypto.js'
import { fixOtpKey, totp } from '../../util/crypto/hotp.js'
import { base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { makeSnrp, scrypt, userIdSnrp } from '../scrypt/scrypt-selectors.js'
import { authRequest } from './authServer.js'
import type { LoginKit, LoginStash, LoginTree } from './login-types.js'
import { applyLoginReply, makeLoginTree, syncLogin } from './login.js'
import { fixUsername, hashUsername } from './loginStore.js'

export const passwordAuthSnrp = userIdSnrp

function makeHashInput (username: string, password: string) {
  return fixUsername(username) + password
}

/**
 * Extracts the loginKey from the login stash.
 */
async function extractLoginKey (
  ai: ApiInput,
  stash: LoginStash,
  username: string,
  password: string
) {
  const { passwordBox, passwordKeySnrp } = stash
  if (passwordBox == null || passwordKeySnrp == null) {
    throw new Error('Missing data for offline password login')
  }
  const up = makeHashInput(username, password)
  const passwordKey = await scrypt(ai, up, passwordKeySnrp)
  return decrypt(passwordBox, passwordKey)
}

/**
 * Fetches the loginKey from the server.
 */
async function fetchLoginKey (
  ai: ApiInput,
  username: string,
  password: string,
  otp: string | void
) {
  const up = makeHashInput(username, password)

  const [userId, passwordAuth] = await Promise.all([
    hashUsername(ai, username),
    scrypt(ai, up, passwordAuthSnrp)
  ])
  const request = {
    userId: base64.stringify(userId),
    passwordAuth: base64.stringify(passwordAuth),
    otp
  }
  const reply = await authRequest(ai, 'POST', '/v2/login', request)
  if (reply.passwordBox == null || reply.passwordKeySnrp == null) {
    throw new Error('Missing data for online password login')
  }
  const passwordKey = await scrypt(ai, up, reply.passwordKeySnrp)
  return {
    loginKey: decrypt(reply.passwordBox, passwordKey),
    loginReply: reply
  }
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @return A `Promise` for the new root login.
 */
export async function loginPassword (
  ai: ApiInput,
  username: string,
  password: string,
  otpKey: string | void
) {
  const { io, loginStore } = ai.props
  let stashTree = await loginStore.load(username)

  try {
    const loginKey = await extractLoginKey(ai, stashTree, username, password)
    const loginTree = makeLoginTree(stashTree, loginKey)

    // Since we logged in offline, update the stash in the background:
    // TODO: If the user provides an OTP token, add that to the stash.
    syncLogin(ai, loginTree, loginTree).catch(e => io.console.warn(e))

    return loginTree
  } catch (e) {
    const { loginKey, loginReply } = await fetchLoginKey(
      ai,
      username,
      password,
      totp(otpKey || stashTree.otpKey)
    )
    stashTree = applyLoginReply(stashTree, loginKey, loginReply)
    if (otpKey) stashTree.otpKey = fixOtpKey(otpKey)
    loginStore.save(stashTree)
    return makeLoginTree(stashTree, loginKey)
  }
}

/**
 * Returns true if the given password is correct.
 */
export function checkPassword (
  ai: ApiInput,
  login: LoginTree,
  password: string
) {
  // Derive passwordAuth:
  const up = makeHashInput(login.username, password)
  return scrypt(ai, up, passwordAuthSnrp).then(passwordAuth => {
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
 * Verifies that a password meets our suggested rules.
 */
export function checkPasswordRules (password: string) {
  const tooShort = password.length < 10
  const noNumber = !/[0-9]/.test(password)
  const noLowerCase = !/[a-z]/.test(password)
  const noUpperCase = !/[A-Z]/.test(password)

  // Quick & dirty password strength estimation:
  const charset =
    (/[0-9]/.test(password) ? 10 : 0) +
    (/[A-Z]/.test(password) ? 26 : 0) +
    (/[a-z]/.test(password) ? 26 : 0) +
    (/[^0-9A-Za-z]/.test(password) ? 30 : 0)
  const secondsToCrack = Math.pow(charset, password.length) / 1e6

  return {
    secondsToCrack,
    tooShort,
    noNumber,
    noLowerCase,
    noUpperCase,
    passed:
      password.length >= 16 ||
      !(tooShort || noNumber || noUpperCase || noLowerCase)
  }
}

/**
 * Creates the data needed to attach a password to a login.
 */
export function makePasswordKit (
  ai: ApiInput,
  login: LoginTree,
  username: string,
  password: string
): Promise<LoginKit> {
  const up = makeHashInput(username, password)
  const { io } = ai.props

  // loginKey chain:
  const boxPromise = makeSnrp(ai).then(passwordKeySnrp => {
    return scrypt(ai, up, passwordKeySnrp).then(passwordKey => {
      const passwordBox = encrypt(io, login.loginKey, passwordKey)
      return { passwordKeySnrp, passwordBox }
    })
  })

  // authKey chain:
  const authPromise = scrypt(ai, up, passwordAuthSnrp).then(passwordAuth => {
    const passwordAuthBox = encrypt(io, passwordAuth, login.loginKey)
    return { passwordAuth, passwordAuthBox }
  })

  return Promise.all([boxPromise, authPromise]).then(values => {
    const [
      { passwordKeySnrp, passwordBox },
      { passwordAuth, passwordAuthBox }
    ] = values
    return {
      serverPath: '/v2/login/password',
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
      },
      loginId: login.loginId
    }
  })
}

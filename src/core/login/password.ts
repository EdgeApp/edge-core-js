import { wasChangePasswordPayload } from '../../types/server-cleaners'
import { EdgeAccountOptions } from '../../types/types'
import { decrypt, encrypt } from '../../util/crypto/crypto'
import { ApiInput } from '../root-pixie'
import { makeSnrp, scrypt, userIdSnrp } from '../scrypt/scrypt-selectors'
import { applyKit, serverLogin, syncLogin } from './login'
import { hashUsername } from './login-selectors'
import { LoginStash, saveStash } from './login-stash'
import { LoginKit, LoginTree, SessionKey } from './login-types'

const passwordAuthSnrp = userIdSnrp

function makeHashInput(username: string, password: string): string {
  return username + password
}

/**
 * Extracts the loginKey from the login stash.
 */
async function loginPasswordOffline(
  ai: ApiInput,
  stashTree: LoginStash,
  password: string,
  opts: EdgeAccountOptions
): Promise<SessionKey> {
  const { now = new Date() } = opts

  const { passwordBox, passwordKeySnrp, username } = stashTree
  if (passwordBox == null || passwordKeySnrp == null || username == null) {
    throw new Error('Missing data for offline password login')
  }
  const up = makeHashInput(username, password)
  const passwordKey = await scrypt(ai, up, passwordKeySnrp)
  const sessionKey = {
    loginId: stashTree.loginId,
    loginKey: decrypt(passwordBox, passwordKey)
  }

  // Save the date:
  stashTree.lastLogin = now
  saveStash(ai, stashTree).catch(() => {})

  // Since we logged in offline, update the stash in the background:
  // TODO: If the user provides an OTP token, add that to the stash.
  const { log } = ai.props
  syncLogin(ai, sessionKey).catch(error => log.error(error))

  return sessionKey
}

/**
 * Fetches the loginKey from the server.
 */
async function loginPasswordOnline(
  ai: ApiInput,
  stashTree: LoginStash,
  password: string,
  opts: EdgeAccountOptions
): Promise<SessionKey> {
  const { username } = stashTree
  if (username == null) throw new Error('Password login requires a username')

  // Request:
  const up = makeHashInput(username, password)
  const [userId, passwordAuth] = await Promise.all([
    hashUsername(ai, username),
    scrypt(ai, up, passwordAuthSnrp)
  ])
  const request = {
    userId,
    passwordAuth
  }
  return await serverLogin(
    ai,
    stashTree,
    stashTree,
    opts,
    request,
    async reply => {
      const { passwordBox, passwordKeySnrp } = reply
      if (
        passwordBox == null ||
        passwordBox === true ||
        passwordKeySnrp == null
      ) {
        throw new Error('Missing data for online password login')
      }
      const passwordKey = await scrypt(ai, up, passwordKeySnrp)
      return decrypt(passwordBox, passwordKey)
    }
  )
}

/**
 * Logs a user in using a password.
 * @param username string
 * @param password string
 * @return A `Promise` for the new root login.
 */
export async function loginPassword(
  ai: ApiInput,
  stashTree: LoginStash,
  password: string,
  opts: EdgeAccountOptions
): Promise<SessionKey> {
  return await loginPasswordOffline(ai, stashTree, password, opts).catch(() =>
    loginPasswordOnline(ai, stashTree, password, opts)
  )
}

export async function changePassword(
  ai: ApiInput,
  accountId: string,
  password: string
): Promise<void> {
  const accountState = ai.props.state.accounts[accountId]
  const { loginTree, sessionKey } = accountState
  const { username } = accountState.stashTree
  if (username == null) throw new Error('Password login requires a username')

  const kit = await makePasswordKit(ai, loginTree, username, password)
  await applyKit(ai, sessionKey, kit)
}

/**
 * Returns true if the given password is correct.
 *
 * Accepts an optional loginKey to check using encryption over decryption as
 * an optimization.
 */
export async function checkPassword(
  ai: ApiInput,
  stash: LoginStash,
  password: string,
  loginKey?: Uint8Array
): Promise<boolean> {
  if (loginKey != null) {
    const { passwordAuthBox, username } = stash
    if (passwordAuthBox == null || username == null) return false
    const passwordAuth = decrypt(passwordAuthBox, loginKey)

    // Derive passwordAuth:
    const up = makeHashInput(username, password)
    const newPasswordAuth = await scrypt(ai, up, passwordAuthSnrp)

    // Compare what we derived with what we have:
    for (let i = 0; i < passwordAuth.length; ++i) {
      if (newPasswordAuth[i] !== passwordAuth[i]) return false
    }

    return true
  } else {
    const { passwordBox, passwordKeySnrp, username } = stash
    if (passwordBox == null || passwordKeySnrp == null || username == null) {
      throw new Error('Missing data for offline password login')
    }
    const up = makeHashInput(username, password)
    const passwordKey = await scrypt(ai, up, passwordKeySnrp)
    try {
      decrypt(passwordBox, passwordKey)
      return true
    } catch (_) {
      return false
    }
  }
}

export async function deletePassword(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree, sessionKey } = ai.props.state.accounts[accountId]

  const kit: LoginKit = {
    loginId: loginTree.loginId,
    server: undefined,
    serverMethod: 'DELETE',
    serverPath: '/v2/login/password',
    stash: {
      passwordAuthSnrp: undefined,
      passwordBox: undefined,
      passwordKeySnrp: undefined
    }
  }
  // Only remove `passwordAuth` if we have another way to get in:
  if (loginTree.loginAuth != null) {
    kit.stash.passwordAuthBox = undefined
  }
  await applyKit(ai, sessionKey, kit)
}

/**
 * Creates the data needed to attach a password to a login.
 */
export async function makePasswordKit(
  ai: ApiInput,
  login: LoginTree,
  username: string,
  password: string
): Promise<LoginKit> {
  const up = makeHashInput(username, password)
  const { io } = ai.props

  const [{ passwordKeySnrp, passwordBox }, { passwordAuth, passwordAuthBox }] =
    await Promise.all([
      // The loginKey, encrypted by the passwordKey:
      makeSnrp(ai).then(async passwordKeySnrp => {
        const passwordKey = await scrypt(ai, up, passwordKeySnrp)
        const passwordBox = encrypt(io, login.loginKey, passwordKey)
        return { passwordKeySnrp, passwordBox }
      }),

      // The passwordAuth, encrypted by the loginKey:
      scrypt(ai, up, passwordAuthSnrp).then(passwordAuth => {
        const passwordAuthBox = encrypt(io, passwordAuth, login.loginKey)
        return { passwordAuth, passwordAuthBox }
      })
    ])

  return {
    loginId: login.loginId,
    server: wasChangePasswordPayload({
      passwordAuth,
      passwordAuthSnrp, // TODO: Use this on the other side
      passwordKeySnrp,
      passwordBox,
      passwordAuthBox
    }),
    serverPath: '/v2/login/password',
    stash: {
      passwordKeySnrp,
      passwordBox,
      passwordAuthBox
    }
  }
}

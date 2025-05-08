import {
  wasChangePin2IdPayload,
  wasChangePin2Payload
} from '../../types/server-cleaners'
import { LoginRequestBody } from '../../types/server-types'
import {
  ChangePinOptions,
  EdgeAccountOptions,
  PinDisabledError
} from '../../types/types'
import { decrypt, encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import {
  applyKits,
  applyKitsTemporarily,
  searchTree,
  serverLogin
} from './login'
import { loginFetch } from './login-fetch'
import { getStashById } from './login-selectors'
import { LoginStash } from './login-stash'
import { LoginKit, LoginTree, SessionKey } from './login-types'
import { getLoginOtp } from './otp'

function makePin2Id(
  pin2Key: Uint8Array,
  username: string | undefined
): Uint8Array {
  const data = username == null ? Uint8Array.from([0]) : utf8.parse(username)
  return hmacSha256(data, pin2Key)
}

function makePin2Auth(pin2Key: Uint8Array, pin: string): Uint8Array {
  return hmacSha256(utf8.parse(pin), pin2Key)
}

/**
 * Returns a copy of the PIN login key if one exists on the local device.
 */
export function findPin2Stash(
  stashTree: LoginStash,
  appId: string
): LoginStash | undefined {
  if (stashTree.pin2Key != null) return stashTree
  const stash = searchTree(stashTree, stash => stash.appId === appId)
  if (stash?.pin2Key != null) return stash
}

/**
 * Logs a user in using their PIN.
 * @return A `Promise` for the new root login.
 */
export async function loginPin2(
  ai: ApiInput,
  stashTree: LoginStash,
  stash: LoginStash,
  pin: string,
  opts: EdgeAccountOptions
): Promise<SessionKey> {
  if (stash.pin2Key == null) {
    throw new PinDisabledError(
      'PIN login is not enabled for this account on this device'
    )
  }

  // Request:
  const { pin2Key } = stash
  const request = {
    pin2Id: makePin2Id(pin2Key, stashTree.username),
    pin2Auth: makePin2Auth(pin2Key, pin)
  }
  return await serverLogin(ai, stashTree, stash, opts, request, async reply => {
    if (reply.pin2Box == null || reply.pin2Box === true) {
      throw new Error('Missing data for PIN v2 login')
    }
    return decrypt(reply.pin2Box, pin2Key)
  })
}

export async function changePin(
  ai: ApiInput,
  accountId: string,
  opts: ChangePinOptions
): Promise<void> {
  const accountState = ai.props.state.accounts[accountId]
  const { loginTree, login, sessionKey } = accountState
  const { username } = accountState.stashTree

  // Figure out defaults:
  let { pin, enableLogin, forDuressAccount = false } = opts

  if (enableLogin == null) {
    enableLogin =
      loginTree.pin2Key != null || (pin != null && loginTree.pin == null)
  }
  if (pin == null) pin = login.pin

  // Deleting PIN logins while in duress account should delete PIN locally for
  // all nodes:
  if (forDuressAccount && !enableLogin) {
    if (pin == null) {
      await applyKitsTemporarily(ai, makeDeletePin2Kits(loginTree))
    } else {
      await applyKitsTemporarily(ai, [
        // Delete for other apps:
        ...makeDeletePin2Kits(loginTree, false),
        // Change PIN for duress app:
        ...makeChangePin2Kits(
          ai,
          loginTree,
          username,
          pin,
          enableLogin,
          forDuressAccount
        )
      ])
    }
    return
  }

  // We cannot enable PIN login if we don't know the PIN:
  if (pin == null) {
    if (enableLogin) {
      throw new Error(
        'Please change your PIN in the settings area above before enabling.'
      )
    }
    // But we can disable PIN login by just deleting it entirely:
    await applyKits(
      ai,
      sessionKey,
      makeDeletePin2Kits(loginTree, forDuressAccount)
    )
    return
  }

  const kits = makeChangePin2Kits(
    ai,
    loginTree,
    username,
    pin,
    enableLogin,
    forDuressAccount
  )
  await applyKits(ai, sessionKey, kits)
}

/**
 * Returns true if the given pin is correct.
 */
export async function checkPin2(
  ai: ApiInput,
  login: LoginTree,
  pin: string
): Promise<boolean> {
  const { appId, loginId, username } = login
  if (username == null) return false

  // Find the stash to use:
  const { stashTree } = getStashById(ai, loginId)
  const stash = findPin2Stash(stashTree, appId)
  if (stash == null || stash.pin2Key == null) {
    throw new PinDisabledError('No PIN set locally for this account')
  }

  // Try a login:
  const { pin2Key } = stash
  const request: LoginRequestBody = {
    pin2Id: makePin2Id(pin2Key, username),
    pin2Auth: makePin2Auth(pin2Key, pin),
    otp: getLoginOtp(login)
  }
  return await loginFetch(ai, 'POST', '/v2/login', request).then(
    good => true,
    bad => false
  )
}

export async function deletePin(
  ai: ApiInput,
  accountId: string,
  forDuressAccount: boolean
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kits = makeDeletePin2Kits(loginTree, forDuressAccount)
  await applyKits(ai, loginTree, kits)
}

/**
 * Creates the data needed to attach a PIN to a tree of logins.
 */
export function makeChangePin2Kits(
  ai: ApiInput,
  loginTree: LoginTree,
  username: string | undefined,
  pin: string,
  enableLogin: boolean,
  forDuressAccount: boolean
): LoginKit[] {
  const out: LoginKit[] = []

  // Only include pin change if the app id matches the duress account flag:
  if (forDuressAccount === loginTree.appId.endsWith('.duress')) {
    out.push(makeChangePin2Kit(ai, loginTree, username, pin, enableLogin))
  }

  for (const child of loginTree.children) {
    out.push(
      ...makeChangePin2Kits(
        ai,
        child,
        username,
        pin,
        enableLogin,
        forDuressAccount
      )
    )
  }

  return out
}

/**
 * Used when changing the username.
 * This won't return anything if the PIN is missing.
 */
export function makeChangePin2IdKit(
  login: LoginTree,
  newUsername: string
): LoginKit | undefined {
  const { loginId, pin2Key } = login
  if (pin2Key == null) return

  return {
    loginId,
    server: wasChangePin2IdPayload({
      pin2Id: makePin2Id(pin2Key, newUsername)
    }),
    serverPath: '',
    stash: {}
  }
}

/**
 * Creates the data needed to attach a PIN to a login.
 */
export function makeChangePin2Kit(
  ai: ApiInput,
  login: LoginTree,
  username: string | undefined,
  pin: string,
  enableLogin: boolean
): LoginKit {
  const { io } = ai.props
  const pin2TextBox = encrypt(io, utf8.parse(pin), login.loginKey)

  if (enableLogin) {
    const { loginId, loginKey, pin2Key = io.random(32) } = login
    const pin2Box = encrypt(io, loginKey, pin2Key)
    const pin2KeyBox = encrypt(io, pin2Key, loginKey)

    return {
      loginId,
      server: wasChangePin2Payload({
        pin2Id: makePin2Id(pin2Key, username),
        pin2Auth: makePin2Auth(pin2Key, pin),
        pin2Box,
        pin2KeyBox,
        pin2TextBox
      }),
      serverPath: '/v2/login/pin2',
      stash: {
        pin2Key,
        pin2TextBox
      }
    }
  } else {
    return {
      loginId: login.loginId,
      server: wasChangePin2Payload({
        pin2Id: undefined,
        pin2Auth: undefined,
        pin2Box: undefined,
        pin2KeyBox: undefined,
        pin2TextBox
      }),
      serverPath: '/v2/login/pin2',
      stash: {
        pin2Key: undefined,
        pin2TextBox
      }
    }
  }
}

/**
 * Creates the data needed to delete a PIN from a tree of logins.
 * @param loginTree - The login tree to create the kits for.
 * @param forDuressAccount - If true, only include the pin change if the app id
 *   matches the duress account flag. If undefined, include the pin change for
 *   all apps.
 */
export function makeDeletePin2Kits(
  loginTree: LoginTree,
  forDuressAccount?: boolean
): LoginKit[] {
  const out: LoginKit[] = []

  // Only include pin change if the app id matches the duress account flag:
  if (
    forDuressAccount == null ||
    forDuressAccount === loginTree.appId.endsWith('.duress')
  ) {
    out.push(makeDeletePin2Kit(loginTree))
  }

  for (const child of loginTree.children) {
    out.push(...makeDeletePin2Kits(child, forDuressAccount))
  }

  return out
}

/**
 * Creates the data needed to delete a PIN from a login.
 */
export function makeDeletePin2Kit(login: LoginTree): LoginKit {
  return {
    loginId: login.loginId,
    server: undefined,
    serverMethod: 'DELETE',
    serverPath: '/v2/login/pin2',
    stash: {
      pin2Key: undefined
    }
  }
}

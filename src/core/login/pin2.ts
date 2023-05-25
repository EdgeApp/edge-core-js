import { uncleaner } from 'cleaners'

import {
  asChangePin2IdPayload,
  asChangePin2Payload
} from '../../types/server-cleaners'
import { LoginRequestBody } from '../../types/server-types'
import { ChangePinOptions, EdgeAccountOptions } from '../../types/types'
import { decrypt, encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import { applyKits, searchTree, serverLogin } from './login'
import { loginFetch } from './login-fetch'
import { getStashById } from './login-selectors'
import { LoginStash } from './login-stash'
import { LoginKit, LoginTree } from './login-types'
import { getLoginOtp } from './otp'

const wasChangePin2IdPayload = uncleaner(asChangePin2IdPayload)
const wasChangePin2Payload = uncleaner(asChangePin2Payload)

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
  appId: string,
  stashTree: LoginStash,
  pin: string,
  opts: EdgeAccountOptions
): Promise<LoginTree> {
  const stash = findPin2Stash(stashTree, appId)
  if (stash == null || stash.pin2Key == null) {
    throw new Error('PIN login is not enabled for this account on this device')
  }

  // Request:
  const { pin2Key } = stash
  const request = {
    pin2Id: makePin2Id(pin2Key, stashTree.username),
    pin2Auth: makePin2Auth(pin2Key, pin)
  }
  return await serverLogin(ai, stashTree, stash, opts, request, async reply => {
    if (reply.pin2Box == null) {
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
  const { loginTree } = accountState
  const { username } = accountState.stashTree
  if (username == null) throw new Error('PIN login requires a username')

  // Figure out defaults:
  let { pin, enableLogin } = opts
  if (enableLogin == null) {
    enableLogin =
      loginTree.pin2Key != null || (pin != null && loginTree.pin == null)
  }
  if (pin == null) pin = loginTree.pin

  // We cannot enable PIN login if we don't know the PIN:
  if (pin == null) {
    if (enableLogin) {
      throw new Error(
        'Please change your PIN in the settings area above before enabling.'
      )
    }
    // But we can disable PIN login by just deleting it entirely:
    await applyKits(ai, loginTree, makeDeletePin2Kits(loginTree))
    return
  }

  const kits = makeChangePin2Kits(ai, loginTree, username, pin, enableLogin)
  await applyKits(ai, loginTree, kits)
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
    throw new Error('No PIN set locally for this account')
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
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kits = makeDeletePin2Kits(loginTree)
  await applyKits(ai, loginTree, kits)
}

/**
 * Creates the data needed to attach a PIN to a tree of logins.
 */
export function makeChangePin2Kits(
  ai: ApiInput,
  loginTree: LoginTree,
  username: string,
  pin: string,
  enableLogin: boolean
): LoginKit[] {
  const out: LoginKit[] = [
    makeChangePin2Kit(ai, loginTree, username, pin, enableLogin)
  ]

  for (const child of loginTree.children) {
    out.push(...makeChangePin2Kits(ai, child, username, pin, enableLogin))
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
    login: {},
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
      serverPath: '/v2/login/pin2',
      server: wasChangePin2Payload({
        pin2Id: makePin2Id(pin2Key, username),
        pin2Auth: makePin2Auth(pin2Key, pin),
        pin2Box,
        pin2KeyBox,
        pin2TextBox
      }),
      stash: {
        pin2Key,
        pin2TextBox
      },
      login: {
        pin2Key,
        pin
      },
      loginId
    }
  } else {
    return {
      serverPath: '/v2/login/pin2',
      server: wasChangePin2Payload({
        pin2Id: undefined,
        pin2Auth: undefined,
        pin2Box: undefined,
        pin2KeyBox: undefined,
        pin2TextBox
      }),
      stash: {
        pin2Key: undefined,
        pin2TextBox
      },
      login: {
        pin2Key: undefined,
        pin
      },
      loginId: login.loginId
    }
  }
}

/**
 * Creates the data needed to delete a PIN from a tree of logins.
 */
export function makeDeletePin2Kits(loginTree: LoginTree): LoginKit[] {
  const out: LoginKit[] = [makeDeletePin2Kit(loginTree)]

  for (const child of loginTree.children) {
    out.push(...makeDeletePin2Kits(child))
  }

  return out
}

/**
 * Creates the data needed to delete a PIN from a login.
 */
export function makeDeletePin2Kit(login: LoginTree): LoginKit {
  return {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/pin2',
    server: undefined,
    stash: {
      pin2Key: undefined
    },
    login: {
      pin2Key: undefined
    },
    loginId: login.loginId
  }
}

// @flow

import {
  type Cleaner,
  asArray,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import { type Disklet, justFiles } from 'disklet'
import { base64 } from 'rfc4648'

import { type EdgeLog, type EdgePendingVoucher } from '../../types/types.js'
import { type EdgeBox, asEdgeBox } from '../../util/crypto/crypto.js'
import { base58 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { type EdgeSnrp, asEdgeSnrp } from '../scrypt/scrypt-pixie.js'
import { fixUsername } from './login-selectors.js'
import { asPendingVoucher } from './login-types.js'

/**
 * The login data we store on disk.
 */
export type LoginStash = {
  // Identity:
  appId: string,
  created?: Date,
  lastLogin?: Date,
  loginId: string,
  userId?: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: Date,
  otpTimeout?: number,
  pendingVouchers: EdgePendingVoucher[],
  voucherId?: string,
  voucherAuth?: string,

  // Return logins:
  loginAuthBox?: EdgeBox,
  parentBox?: EdgeBox,

  // Password login:
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN v2 login:
  pin2Key?: string,
  pin2TextBox?: EdgeBox,

  // Recovery v2 login:
  recovery2Key?: string,

  // Keys and assorted goodies:
  children?: LoginStash[],
  keyBoxes?: EdgeBox[],
  mnemonicBox?: EdgeBox,
  rootKeyBox?: EdgeBox,
  syncKeyBox?: EdgeBox
}

/**
 * Reads all login stashes from disk.
 */
export async function loadStashes(
  disklet: Disklet,
  log: EdgeLog
): Promise<LoginStash[]> {
  const out: LoginStash[] = []
  const paths = await disklet.list('logins').then(justFiles)
  for (const path of paths) {
    try {
      out.push(asLoginStash(JSON.parse(await disklet.getText(path))))
    } catch (error) {
      log.error(`Could not load ${path}: ${String(error)}`)
    }
  }
  return out
}

/**
 * Removes any login stash that may be stored for the given username.
 */
export async function removeStash(
  ai: ApiInput,
  username: string
): Promise<void> {
  const { dispatch, io } = ai.props
  const fixedName = fixUsername(username)

  const paths = await io.disklet.list('logins').then(justFiles)
  for (const path of paths) {
    try {
      const stash = asLoginStash(JSON.parse(await io.disklet.getText(path)))
      if (stash.username === fixedName) await io.disklet.delete(path)
    } catch (e) {}
  }

  dispatch({
    type: 'LOGIN_STASH_DELETED',
    payload: fixUsername(username)
  })
}

/**
 * Saves a login stash tree to disk.
 */
export async function saveStash(
  ai: ApiInput,
  stashTree: LoginStash
): Promise<void> {
  const { dispatch, io } = ai.props
  if (stashTree.appId !== '') {
    throw new Error('Cannot save a login without an appId.')
  }
  if (stashTree.loginId == null) {
    throw new Error('Cannot save a login without a loginId.')
  }
  if (stashTree.username == null) {
    throw new Error('Cannot save a login without a username.')
  }
  const loginId = base64.parse(stashTree.loginId)
  if (loginId.length !== 32) {
    throw new Error('Invalid loginId')
  }
  await io.disklet.setText(
    `logins/${base58.stringify(loginId)}.json`,
    JSON.stringify(stashTree)
  )

  dispatch({ type: 'LOGIN_STASH_SAVED', payload: stashTree })
}

export const asLoginStash: Cleaner<LoginStash> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate),
  lastLogin: asOptional(asDate),
  loginId: asString,
  userId: asOptional(asString),
  username: asOptional(asString),

  // 2-factor:
  otpKey: asOptional(asString),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),
  pendingVouchers: asOptional(asArray(asPendingVoucher), []),
  voucherId: asOptional(asString),
  voucherAuth: asOptional(asString),

  // Return logins:
  loginAuthBox: asOptional(asEdgeBox),
  parentBox: asOptional(asEdgeBox),

  // Password login:
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Key: asOptional(asString),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  recovery2Key: asOptional(asString),

  // Keys and assorted goodies:
  children: asOptional(asArray(raw => asLoginStash(raw))),
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})

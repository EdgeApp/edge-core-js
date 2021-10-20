// @flow

import {
  type Cleaner,
  asArray,
  asCodec,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString,
  uncleaner
} from 'cleaners'
import { type Disklet, justFiles } from 'disklet'
import { base64 } from 'rfc4648'

import {
  asBase32,
  asBase64,
  asEdgeBox,
  asEdgePendingVoucher,
  asEdgeSnrp
} from '../../types/server-cleaners.js'
import { type EdgeBox, type EdgeSnrp } from '../../types/server-types.js'
import { type EdgeLog, type EdgePendingVoucher } from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { fixUsername } from './login-selectors.js'

/**
 * The login data we store on disk.
 */
export type LoginStash = {
  // Identity:
  appId: string,
  created?: Date,
  lastLogin?: Date,
  loginId: Uint8Array,
  userId?: Uint8Array,
  username?: string,

  // 2-factor:
  otpKey?: Uint8Array,
  otpResetDate?: Date,
  otpTimeout?: number,
  pendingVouchers: EdgePendingVoucher[],
  voucherId?: string,
  voucherAuth?: Uint8Array,

  // Return logins:
  loginAuthBox?: EdgeBox,
  parentBox?: EdgeBox,

  // Password login:
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN v2 login:
  pin2Key?: Uint8Array,
  pin2TextBox?: EdgeBox,

  // Recovery v2 login:
  recovery2Key?: Uint8Array,

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
  const { appId, loginId, username } = stashTree

  if (appId !== '') {
    throw new Error('Cannot save a login without an appId.')
  }
  if (username == null) {
    throw new Error('Cannot save a login without a username.')
  }
  if (loginId == null || loginId.length !== 32) {
    throw new Error('Invalid loginId')
  }
  await io.disklet.setText(
    `logins/${base58.stringify(loginId)}.json`,
    JSON.stringify(wasLoginStash(stashTree))
  )

  dispatch({ type: 'LOGIN_STASH_SAVED', payload: stashTree })
}

export const asLoginStash: Cleaner<LoginStash> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate),
  lastLogin: asOptional(asDate),
  loginId: asBase64,
  userId: asOptional(asBase64),
  username: asOptional(asString),

  // 2-factor:
  otpKey: asOptional(asBase32),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),
  pendingVouchers: asOptional(asArray(asEdgePendingVoucher), []),
  voucherId: asOptional(asString),
  voucherAuth: asOptional(asBase64),

  // Return logins:
  loginAuthBox: asOptional(asEdgeBox),
  parentBox: asOptional(asEdgeBox),

  // Password login:
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Key: asOptional(
    asCodec(
      // Legacy Airbitz can wrongly send this in base58 for Edge login:
      raw => {
        const clean = asString(raw)
        return raw.slice(-1) !== '=' ? base58.parse(clean) : base64.parse(clean)
      },
      clean => base64.stringify(clean)
    )
  ),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  recovery2Key: asOptional(asBase64),

  // Keys and assorted goodies:
  children: asOptional(asArray(raw => asLoginStash(raw))),
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})
const wasLoginStash = uncleaner(asLoginStash)

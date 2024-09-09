import type { Cleaner } from 'cleaners'
import {
  asArray,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
  uncleaner
} from 'cleaners'

import {
  asBase32,
  asBase64,
  asEdgeBox,
  asEdgeKeyBox,
  asEdgeSnrp,
  asRecovery2Auth
} from './server-cleaners'
import type { EdgeBox, EdgeKeyBox, EdgeSnrp } from './server-types'

export interface EdgeRepoDump {
  [key: string]: EdgeBox
}

export interface EdgeVoucherDump {
  // Identity:
  loginId: Uint8Array
  voucherAuth: Uint8Array
  voucherId: string

  // Login capability:
  created: Date
  activates: Date // Automatically becomes approved on this date
  status: 'pending' | 'approved' | 'rejected'

  // Information about the login:
  ip: string
  ipDescription: string
  deviceDescription: string | undefined
}

export interface EdgeLoginDump {
  // Identity:
  appId: string
  created: Date
  loginId: Uint8Array

  // Nested logins:
  parentBox?: EdgeBox
  parentId?: Uint8Array // loginId

  // 2-factor login:
  otpKey?: Uint8Array
  otpResetAuth?: string
  otpResetDate?: Date
  otpTimeout?: number

  // Password login:
  passwordAuth?: Uint8Array
  passwordAuthBox?: EdgeBox
  passwordAuthSnrp?: EdgeSnrp
  passwordBox?: EdgeBox
  passwordKeySnrp?: EdgeSnrp

  // PIN v2 login:
  pin2Id?: Uint8Array // base64
  pin2Auth?: Uint8Array
  pin2Box?: EdgeBox
  pin2KeyBox?: EdgeBox
  pin2TextBox?: EdgeBox

  // Recovery v2 login:
  recovery2Id?: Uint8Array // base64
  recovery2Auth?: Uint8Array[]
  recovery2Box?: EdgeBox
  recovery2KeyBox?: EdgeBox
  question2Box?: EdgeBox

  // Secret-key login:
  loginAuth?: Uint8Array
  loginAuthBox?: EdgeBox

  // Username:
  userId?: Uint8Array
  userTextBox?: EdgeBox

  // Resources:
  children: EdgeLoginDump[]
  keyBoxes: EdgeKeyBox[]
  mnemonicBox?: EdgeBox
  rootKeyBox?: EdgeBox
  syncKeyBox?: EdgeBox
  vouchers: EdgeVoucherDump[]

  // Obsolete:
  pinBox?: EdgeBox
  pinId?: string
  pinKeyBox?: EdgeBox
}

export const asEdgeRepoDump: Cleaner<EdgeRepoDump> = asObject(asEdgeBox)

export const asEdgeVoucherDump: Cleaner<EdgeVoucherDump> = asObject({
  // Identity:
  loginId: asBase64,
  voucherAuth: asBase64,
  voucherId: asString,

  // Login capability:
  created: asDate,
  activates: asDate, // Automatically becomes approved on this date
  status: asValue('pending', 'approved', 'rejected'),

  // Information about the login:
  ip: asString,
  ipDescription: asString,
  deviceDescription: asOptional(asString)
})

export const asEdgeLoginDump: Cleaner<EdgeLoginDump> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate, () => new Date()),
  loginId: asBase64,

  // Nested logins:
  children: asOptional(
    asArray(raw => asEdgeLoginDump(raw)),
    () => []
  ),
  parentBox: asOptional(asEdgeBox),
  parentId: (): Uint8Array | undefined => undefined,

  // 2-factor login:
  otpKey: asOptional(asBase32),
  otpResetAuth: asOptional(asString),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),

  // Password login:
  passwordAuth: asOptional(asBase64),
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Id: asOptional(asBase64),
  pin2Auth: asOptional(asBase64),
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  recovery2Id: asOptional(asBase64),
  recovery2Auth: asOptional(asRecovery2Auth),
  question2Box: asOptional(asEdgeBox),
  recovery2Box: asOptional(asEdgeBox),
  recovery2KeyBox: asOptional(asEdgeBox),

  // Secret-key login:
  loginAuth: asOptional(asBase64),
  loginAuthBox: asOptional(asEdgeBox),

  // Username:
  userId: asOptional(asBase64),
  userTextBox: asOptional(asEdgeBox),

  // Keys and assorted goodies:
  keyBoxes: asOptional(asArray(asEdgeKeyBox), () => []),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox),
  vouchers: asOptional(asArray(asEdgeVoucherDump), () => []),

  // Obsolete:
  pinBox: asOptional(asEdgeBox),
  pinId: asOptional(asString),
  pinKeyBox: asOptional(asEdgeBox)
})

export const wasEdgeLoginDump = uncleaner<EdgeLoginDump>(asEdgeLoginDump)
export const wasEdgeRepoDump = uncleaner<EdgeRepoDump>(asEdgeRepoDump)

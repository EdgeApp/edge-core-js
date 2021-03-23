// @flow

import {
  type Cleaner,
  asArray,
  asBoolean,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import { base64 } from 'rfc4648'

import {
  type ChangeOtpPayload,
  type ChangePasswordPayload,
  type ChangePin2Payload,
  type ChangeRecovery2Payload,
  type ChangeSecretPayload,
  type ChangeVouchersPayload,
  type CreateKeysPayload,
  type CreateLoginPayload,
  type EdgeBox,
  type EdgeLobbyReply,
  type EdgeLobbyRequest,
  type EdgeSnrp,
  type LobbyPayload,
  type LoginPayload,
  type LoginRequestBody,
  type LoginResponseBody,
  type MessagesPayload,
  type OtpResetPayload,
  type QuestionChoicesPayload,
  type StartRecoveryPayload
} from './server-types.js'
import {
  type EdgeLoginMessage,
  type EdgePendingVoucher,
  type EdgeRecoveryQuestionChoice
} from './types.js'

export function makeLoginJson(value: mixed, spaces: number = 0): string {
  return JSON.stringify(
    value,
    (key, value) => {
      if (value instanceof Uint8Array) {
        return base64.stringify(value)
      }
      return value
    },
    spaces
  )
}

/**
 * A string of base64-encoded binary data.
 */
export const asBase64: Cleaner<Uint8Array> = raw => base64.parse(asString(raw))

// ---------------------------------------------------------------------
// public Edge types
// ---------------------------------------------------------------------

export const asEdgePendingVoucher: Cleaner<EdgePendingVoucher> = asObject({
  voucherId: asString,
  activates: asDate,
  created: asDate,
  ip: asString,
  ipDescription: asString,
  deviceDescription: asOptional(asString)
})

const asEdgeLoginMessage: Cleaner<EdgeLoginMessage> = asObject({
  loginId: asString,
  otpResetPending: asOptional(asBoolean, false),
  pendingVouchers: asOptional(asArray(asEdgePendingVoucher), []),
  recovery2Corrupt: asOptional(asBoolean, false)
})

const asEdgeRecoveryQuestionChoice: Cleaner<EdgeRecoveryQuestionChoice> = asObject(
  {
    min_length: asNumber,
    category: raw => {
      const clean = asString(raw)
      switch (clean) {
        case 'address':
        case 'must':
        case 'numeric':
        case 'recovery2':
        case 'string':
          return clean
      }
      throw new TypeError('Invalid question category')
    },
    question: asString
  }
)

// ---------------------------------------------------------------------
// internal Edge types
// ---------------------------------------------------------------------

export const asEdgeBox: Cleaner<EdgeBox> = asObject({
  encryptionType: asNumber,
  data_base64: asString,
  iv_hex: asString
})

export const asEdgeSnrp: Cleaner<EdgeSnrp> = asObject({
  salt_hex: asString,
  n: asNumber,
  r: asNumber,
  p: asNumber
})

export const asEdgeLobbyRequest: Cleaner<EdgeLobbyRequest> = asObject({
  publicKey: asString,
  loginRequest: asOptional(asObject({ appId: asString }).withRest),
  timeout: asOptional(asNumber)
}).withRest

export const asEdgeLobbyReply: Cleaner<EdgeLobbyReply> = asObject({
  publicKey: asString,
  box: asEdgeBox
})

/**
 * An array of base64-encoded hashed recovery answers.
 */
export const asRecovery2Auth: Cleaner<Uint8Array[]> = asArray(asBase64)

// ---------------------------------------------------------------------
// top-level request & response bodies
// ---------------------------------------------------------------------

export const asLoginRequestBody: Cleaner<LoginRequestBody> = asObject({
  // The request payload:
  data: asUnknown,

  // Common fields for all login methods:
  deviceDescription: asOptional(asString),
  otp: asOptional(asString),
  voucherId: asOptional(asString),
  voucherAuth: asOptional(asBase64),

  // Secret-key login:
  loginId: asOptional(asString),
  loginAuth: asOptional(asBase64),

  // Password login:
  userId: asOptional(asString),
  passwordAuth: asOptional(asString),

  // PIN login:
  pin2Id: asOptional(asString),
  pin2Auth: asOptional(asBase64),

  // Recovery login:
  recovery2Id: asOptional(asString),
  recovery2Auth: asOptional(asRecovery2Auth),

  // Messages:
  loginIds: asOptional(asArray(asString)),

  // OTP reset:
  otpResetAuth: asOptional(asString),

  // Legacy:
  did: asOptional(asString),
  l1: asOptional(asString),
  lp1: asOptional(asString),
  lpin1: asOptional(asBase64),
  lra1: asOptional(asString),
  recoveryAuth: asOptional(asString) // lra1
})

export const asLoginResponseBody: Cleaner<LoginResponseBody> = asObject({
  // The response payload:
  results: asOptional(asUnknown),

  // What type of response is this (success or failure)?:
  status_code: asNumber,
  message: asString
})

// ---------------------------------------------------------------------
// request payloads
// ---------------------------------------------------------------------

export const asChangeOtpPayload: Cleaner<ChangeOtpPayload> = asObject({
  otpTimeout: asOptional(asNumber, 7 * 24 * 60 * 60), // seconds
  otpKey: asString
})

export const asChangePasswordPayload: Cleaner<ChangePasswordPayload> = asObject(
  {
    passwordAuth: asString,
    passwordAuthBox: asEdgeBox,
    passwordAuthSnrp: asEdgeSnrp,
    passwordBox: asEdgeBox,
    passwordKeySnrp: asEdgeSnrp
  }
)

export const asChangePin2Payload: Cleaner<ChangePin2Payload> = asObject({
  pin2Id: asOptional(asString),
  pin2Auth: asOptional(asBase64),
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asEdgeBox
})

export const asChangeRecovery2Payload: Cleaner<ChangeRecovery2Payload> = asObject(
  {
    recovery2Id: asString,
    recovery2Auth: asRecovery2Auth,
    recovery2Box: asEdgeBox,
    recovery2KeyBox: asEdgeBox,
    question2Box: asEdgeBox
  }
)

export const asChangeSecretPayload: Cleaner<ChangeSecretPayload> = asObject({
  loginAuthBox: asEdgeBox,
  loginAuth: asBase64
})

export const asChangeVouchersPayload: Cleaner<ChangeVouchersPayload> = asObject(
  {
    approvedVouchers: asOptional(asArray(asString)),
    rejectedVouchers: asOptional(asArray(asString))
  }
)

export const asCreateKeysPayload: Cleaner<CreateKeysPayload> = asObject({
  keyBoxes: asArray(asEdgeBox),
  newSyncKeys: asOptional(asArray(asString), [])
})

export const asCreateLoginPayload: Cleaner<CreateLoginPayload> = asObject({
  appId: asString,
  loginId: asString, // base64
  parentBox: asOptional(asEdgeBox)
}).withRest

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

export const asLobbyPayload: Cleaner<LobbyPayload> = asObject({
  request: asEdgeLobbyRequest,
  replies: asArray(asEdgeLobbyReply)
})

export const asLoginPayload: Cleaner<LoginPayload> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate),
  loginId: asString,

  // Nested logins:
  children: asOptional(asArray(raw => asLoginPayload(raw))),
  parentBox: asOptional(asEdgeBox),

  // 2-factor login:
  otpKey: asOptional(asString),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),

  // Password login:
  passwordAuthBox: asOptional(asEdgeBox),
  passwordAuthSnrp: asOptional(asEdgeSnrp),
  passwordBox: asOptional(asEdgeBox),
  passwordKeySnrp: asOptional(asEdgeSnrp),

  // PIN v2 login:
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asOptional(asEdgeBox),

  // Recovery v2 login:
  question2Box: asOptional(asEdgeBox),
  recovery2Box: asOptional(asEdgeBox),
  recovery2KeyBox: asOptional(asEdgeBox),

  // Secret-key login:
  loginAuthBox: asOptional(asEdgeBox),

  // Voucher login:
  pendingVouchers: asOptional(asArray(asEdgePendingVoucher), []),

  // Resources:
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})

export const asMessagesPayload: Cleaner<MessagesPayload> = asArray(
  asEdgeLoginMessage
)

export const asOtpResetPayload: Cleaner<OtpResetPayload> = asObject({
  otpResetDate: asDate
})

export const asQuestionChoicesPayload: Cleaner<QuestionChoicesPayload> = asArray(
  asEdgeRecoveryQuestionChoice
)

export const asStartRecoveryPayload: Cleaner<StartRecoveryPayload> = asObject({
  question2Box: asEdgeBox
})

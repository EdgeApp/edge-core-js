// @flow

import {
  type Cleaner,
  asArray,
  asBoolean,
  asDate,
  asNone,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import { base64 } from 'rfc4648'

import {
  type EdgeBox,
  type EdgeSnrp,
  type KeysCreatePayload,
  type LobbyPayload,
  type LobbyReply,
  type LobbyRequest,
  type LoginCreatePayload,
  type LoginPayload,
  type LoginRequest,
  type LoginResponse,
  type OtpPayload,
  type OtpResetPayload,
  type PasswordPayload,
  type Pin2DisablePayload,
  type Pin2EnablePayload,
  type QuestionChoicesPayload,
  type Recovery2Payload,
  type SecretPayload,
  type StartRecoveryPayload
} from './server-types.js'
import { type EdgeLoginMessage, type EdgePendingVoucher } from './types.js'

/**
 * A string of base64-encoded binary data.
 */
export const asBase64: Cleaner<Uint8Array> = raw => base64.parse(asString(raw))

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

/**
 * A pending request to log in from a new device.
 */
export const asPendingVoucher: Cleaner<EdgePendingVoucher> = asObject({
  voucherId: asString,
  activates: asDate,
  created: asDate,
  ip: asString,
  ipDescription: asString,
  deviceDescription: asOptional(asString)
})

// ---------------------------------------------------------------------
// top-level request & response bodies
// ---------------------------------------------------------------------

/**
 * Data sent to authenticate with the login server.
 */
export const asLoginRequest: Cleaner<LoginRequest> = asObject({
  // The request payload:
  data: asUnknown,

  // Common fields for all login methods:
  deviceDescription: asOptional(asString),
  otp: asOptional(asString),
  voucherId: asOptional(asString),
  voucherAuth: asOptional(asString),

  // Secret-key login:
  loginId: asOptional(asString),
  loginAuth: asOptional(asString),

  // Password login:
  userId: asOptional(asString),
  passwordAuth: asOptional(asString),

  // PIN login:
  pin2Id: asOptional(asString),
  pin2Auth: asOptional(asString),

  // Recovery login:
  recovery2Id: asOptional(asString),
  recovery2Auth: asOptional(asArray(asString))
})

export const asLoginResponse: Cleaner<LoginResponse> = asObject({
  // The response payload:
  results: asOptional(asUnknown),

  // What type of response is this (success or failure)?:
  status_code: asNumber,
  message: asString
})

// ---------------------------------------------------------------------
// request payloads
// ---------------------------------------------------------------------

export const asKeysCreatePayload: Cleaner<KeysCreatePayload> = asObject({
  keyBoxes: asArray(asEdgeBox),
  newSyncKeys: asOptional(asArray(asString), [])
})

export const asLoginCreatePayload: Cleaner<LoginCreatePayload> = asObject({
  appId: asString,
  loginId: asString, // base64
  parentBox: asOptional(asEdgeBox)
}).withRest

export const asOtpPayload: Cleaner<OtpPayload> = asObject({
  otpTimeout: asOptional(asNumber, 7 * 24 * 60 * 60), // seconds
  otpKey: asString
})

export const asPasswordPayload: Cleaner<PasswordPayload> = asObject({
  passwordAuth: asString,
  passwordAuthBox: asEdgeBox,
  passwordAuthSnrp: asEdgeSnrp,
  passwordBox: asEdgeBox,
  passwordKeySnrp: asEdgeSnrp
})

export const asPin2DisablePayload: Cleaner<Pin2DisablePayload> = asObject({
  pin2Id: asNone,
  pin2Auth: asNone,
  pin2Box: asNone,
  pin2KeyBox: asNone,
  pin2TextBox: asEdgeBox
})

export const asPin2EnablePayload: Cleaner<Pin2EnablePayload> = asObject({
  pin2Id: asString,
  pin2Auth: asString, // asBase64
  pin2Box: asEdgeBox,
  pin2KeyBox: asEdgeBox,
  pin2TextBox: asEdgeBox
})

export const asRecovery2Payload: Cleaner<Recovery2Payload> = asObject({
  recovery2Id: asString,
  recovery2Auth: asArray(asString), // asBase64
  recovery2Box: asEdgeBox,
  recovery2KeyBox: asEdgeBox,
  question2Box: asEdgeBox
})

export const asSecretPayload: Cleaner<SecretPayload> = asObject({
  loginAuthBox: asEdgeBox,
  loginAuth: asString // asBase64
})

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

/**
 * Data sent back by the login server.
 */
export const asLoginPayload: Cleaner<LoginPayload> = asObject({
  // Identity:
  appId: asString,
  created: asOptional(asDate),
  loginId: asString,

  // 2-factor:
  otpKey: asOptional(asString),
  otpResetDate: asOptional(asDate),
  otpTimeout: asOptional(asNumber),
  pendingVouchers: asOptional(asArray(asPendingVoucher), []),

  // Return logins:
  loginAuthBox: asOptional(asEdgeBox),
  parentBox: asOptional(asEdgeBox),

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

  // Keys and assorted goodies:
  children: asOptional(asArray(raw => asLoginPayload(raw))),
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})

/**
 * Account status information sent back by the login server.
 */
export const asMessagesPayload: Cleaner<EdgeLoginMessage[]> = asArray(
  asObject({
    loginId: asString,
    otpResetPending: asOptional(asBoolean, false),
    pendingVouchers: asOptional(asArray(asPendingVoucher), []),
    recovery2Corrupt: asOptional(asBoolean, false)
  })
)

export const asOtpResetPayload: Cleaner<OtpResetPayload> = asObject({
  otpResetDate: asDate
})

export const asStartRecoveryPayload: Cleaner<StartRecoveryPayload> = asObject({
  question2Box: asEdgeBox
})

export const asQuestionChoicesPayload: Cleaner<QuestionChoicesPayload> = asArray(
  asObject({
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
  })
)

// ---------------------------------------------------------------------
// lobby subsystem
// ---------------------------------------------------------------------

export const asLobbyRequest: Cleaner<LobbyRequest> = asObject({
  publicKey: asString,
  loginRequest: asOptional(asObject({ appId: asString }).withRest),
  timeout: asOptional(asNumber)
}).withRest

export const asLobbyReply: Cleaner<LobbyReply> = asObject({
  publicKey: asString,
  box: asEdgeBox
})

export const asLobbyPayload: Cleaner<LobbyPayload> = asObject({
  request: asLobbyRequest,
  replies: asArray(asLobbyReply)
})

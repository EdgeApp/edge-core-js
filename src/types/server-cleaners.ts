import type { Cleaner } from 'cleaners'
import {
  asArray,
  asBoolean,
  asCodec,
  asDate,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue,
  uncleaner
} from 'cleaners'
import { base16, base32, base64 } from 'rfc4648'

import type {
  ChallengeErrorPayload,
  ChangeOtpPayload,
  ChangePasswordPayload,
  ChangePin2IdPayload,
  ChangePin2Payload,
  ChangeRecovery2IdPayload,
  ChangeRecovery2Payload,
  ChangeSecretPayload,
  ChangeUsernamePayload,
  ChangeVouchersPayload,
  CreateKeysPayload,
  CreateLoginPayload,
  EdgeBox,
  EdgeLobbyReply,
  EdgeLobbyRequest,
  EdgeSnrp,
  LobbyPayload,
  LoginPayload,
  LoginRequestBody,
  LoginResponseBody,
  MessagesPayload,
  OtpErrorPayload,
  OtpResetPayload,
  PasswordErrorPayload,
  QuestionChoicesPayload,
  Recovery2InfoPayload,
  UsernameInfoPayload
} from './server-types'
import type { EdgePendingVoucher, EdgeRecoveryQuestionChoice } from './types'

/**
 * A string of hex-encoded binary data.
 */
export const asBase16: Cleaner<Uint8Array> = asCodec(
  raw => base16.parse(asString(raw)),
  clean => base16.stringify(clean).toLowerCase()
)

/**
 * A string of base32-encoded binary data.
 */
export const asBase32: Cleaner<Uint8Array> = asCodec(
  raw => base32.parse(asString(raw), { loose: true }),
  clean => base32.stringify(clean, { pad: false })
)

/**
 * A string of base64-encoded binary data.
 */
export const asBase64: Cleaner<Uint8Array> = asCodec(
  raw => base64.parse(asString(raw)),
  clean => base64.stringify(clean)
)

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

/** @deprecated The GUI provides its own localized strings now. */
const asEdgeRecoveryQuestionChoice: Cleaner<EdgeRecoveryQuestionChoice> =
  asObject({
    min_length: asNumber,
    category: asValue('address', 'must', 'numeric', 'recovery2', 'string'),
    question: asString
  })

// ---------------------------------------------------------------------
// internal Edge types
// ---------------------------------------------------------------------

export const asEdgeBox: Cleaner<EdgeBox> = asObject({
  encryptionType: asNumber,
  data_base64: asBase64,
  iv_hex: asBase16
})

export const asEdgeSnrp: Cleaner<EdgeSnrp> = asObject({
  salt_hex: asBase16,
  n: asNumber,
  r: asNumber,
  p: asNumber
})

export const asEdgeLobbyRequest: Cleaner<EdgeLobbyRequest> = asObject({
  loginRequest: asOptional(asObject({ appId: asString }).withRest),
  publicKey: asBase64,
  timeout: asOptional(asNumber)
}).withRest

export const asEdgeLobbyReply: Cleaner<EdgeLobbyReply> = asObject({
  publicKey: asBase64,
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
  challengeId: asOptional(asString),
  deviceDescription: asOptional(asString),
  otp: asOptional(asString),
  syncToken: asOptional(asString),
  voucherId: asOptional(asString),
  voucherAuth: asOptional(asBase64),

  // Secret-key login:
  loginId: asOptional(asBase64),
  loginAuth: asOptional(asBase64),

  // Password login:
  userId: asOptional(asBase64),
  passwordAuth: asOptional(asBase64),

  // PIN login:
  pin2Id: asOptional(asBase64),
  pin2Auth: asOptional(asBase64),

  // Recovery login:
  recovery2Id: asOptional(asBase64),
  recovery2Auth: asOptional(asRecovery2Auth),

  // Messages:
  loginIds: asOptional(asArray(asBase64)),

  // OTP reset:
  otpResetAuth: asOptional(asString),

  // Legacy:
  did: asOptional(asString),
  l1: asOptional(asBase64),
  lp1: asOptional(asBase64),
  lpin1: asOptional(asBase64),
  lra1: asOptional(asBase64),
  recoveryAuth: asOptional(asBase64) // lra1
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
  otpKey: asBase32
})

export const asChangePasswordPayload: Cleaner<ChangePasswordPayload> = asObject(
  {
    passwordAuth: asBase64,
    passwordAuthBox: asEdgeBox,
    passwordAuthSnrp: asEdgeSnrp,
    passwordBox: asEdgeBox,
    passwordKeySnrp: asEdgeSnrp
  }
)

export const asChangePin2IdPayload: Cleaner<ChangePin2IdPayload> = asObject({
  pin2Id: asBase64
})

export const asChangePin2Payload: Cleaner<ChangePin2Payload> = asObject({
  pin2Id: asOptional(asBase64),
  pin2Auth: asOptional(asBase64),
  pin2Box: asOptional(asEdgeBox),
  pin2KeyBox: asOptional(asEdgeBox),
  pin2TextBox: asEdgeBox
})

export const asChangeRecovery2IdPayload: Cleaner<ChangeRecovery2IdPayload> =
  asObject({
    recovery2Id: asBase64
  })

export const asChangeRecovery2Payload: Cleaner<ChangeRecovery2Payload> =
  asObject({
    recovery2Id: asBase64,
    recovery2Auth: asRecovery2Auth,
    recovery2Box: asEdgeBox,
    recovery2KeyBox: asEdgeBox,
    question2Box: asEdgeBox
  })

export const asChangeSecretPayload: Cleaner<ChangeSecretPayload> = asObject({
  loginAuthBox: asEdgeBox,
  loginAuth: asBase64
})

export const asChangeUsernamePayload: Cleaner<ChangeUsernamePayload> = asObject(
  {
    userId: asBase64,
    userTextBox: asEdgeBox
  }
)

export const asChangeVouchersPayload: Cleaner<ChangeVouchersPayload> = asObject(
  {
    approvedVouchers: asOptional(asArray(asString)),
    rejectedVouchers: asOptional(asArray(asString))
  }
)

export const asCreateKeysPayload: Cleaner<CreateKeysPayload> = asObject({
  keyBoxes: asArray(asEdgeBox),
  newSyncKeys: asOptional(asArray(asString), () => [])
})

export const asCreateLoginPayload: Cleaner<CreateLoginPayload> = asObject({
  appId: asString,
  loginId: asBase64,
  parentBox: asOptional(asEdgeBox)
})

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

export const asChallengeErrorPayload: Cleaner<ChallengeErrorPayload> = asObject(
  {
    challengeId: asString,
    challengeUri: asString
  }
)

export const asLobbyPayload: Cleaner<LobbyPayload> = asObject({
  request: asEdgeLobbyRequest,
  replies: asArray(asEdgeLobbyReply)
})

export const asLoginPayload: Cleaner<LoginPayload> = asObject({
  // Identity:
  appId: asString,
  created: asDate,
  loginId: asBase64,
  syncToken: asOptional(asString),

  // Nested logins:
  children: asOptional(asArray(raw => asLoginPayload(raw))),
  parentBox: asOptional(asEdgeBox),

  // 2-factor login:
  otpKey: asOptional(asBase32),
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

  // Username:
  userId: asOptional(asBase64),
  userTextBox: asOptional(asEdgeBox),

  // Voucher login:
  pendingVouchers: asOptional(asArray(asEdgePendingVoucher), () => []),

  // Resources:
  keyBoxes: asOptional(asArray(asEdgeBox)),
  mnemonicBox: asOptional(asEdgeBox),
  rootKeyBox: asOptional(asEdgeBox),
  syncKeyBox: asOptional(asEdgeBox)
})

export const asMessagesPayload: Cleaner<MessagesPayload> = asArray(
  asObject({
    loginId: asBase64,
    otpResetPending: asOptional(asBoolean, false),
    pendingVouchers: asOptional(asArray(asEdgePendingVoucher), () => []),
    recovery2Corrupt: asOptional(asBoolean, false)
  })
)

export const asOtpErrorPayload: Cleaner<OtpErrorPayload> = asObject({
  login_id: asOptional(asBase64),
  otp_reset_auth: asOptional(asString),
  otp_timeout_date: asOptional(asDate),
  reason: asOptional(asValue('ip', 'otp'), 'otp'),
  voucher_activates: asOptional(asDate),
  voucher_auth: asOptional(asBase64),
  voucher_id: asOptional(asString)
})

export const asOtpResetPayload: Cleaner<OtpResetPayload> = asObject({
  otpResetDate: asDate
})

export const asPasswordErrorPayload: Cleaner<PasswordErrorPayload> = asObject({
  wait_seconds: asOptional(asNumber)
})

/** @deprecated The GUI provides its own localized strings now. */
export const asQuestionChoicesPayload: Cleaner<QuestionChoicesPayload> =
  asArray(asEdgeRecoveryQuestionChoice)

export const asRecovery2InfoPayload: Cleaner<Recovery2InfoPayload> = asObject({
  question2Box: asEdgeBox
})

export const asUsernameInfoPayload: Cleaner<UsernameInfoPayload> = asObject({
  loginId: asBase64,

  // Password login:
  passwordAuthSnrp: asOptional(asEdgeSnrp),

  // Recovery v1 login:
  questionBox: asOptional(asEdgeBox),
  questionKeySnrp: asOptional(asEdgeSnrp),
  recoveryAuthSnrp: asOptional(asEdgeSnrp)
})

// ---------------------------------------------------------------------
// uncleaners
// ---------------------------------------------------------------------

// Common types:
export const wasEdgeBox = uncleaner<EdgeBox>(asEdgeBox)
export const wasEdgeLobbyReply = uncleaner<EdgeLobbyReply>(asEdgeLobbyReply)
export const wasEdgeLobbyRequest =
  uncleaner<EdgeLobbyRequest>(asEdgeLobbyRequest)

// Top-level request / response bodies:
export const wasLoginRequestBody =
  uncleaner<LoginRequestBody>(asLoginRequestBody)
export const wasLoginResponseBody =
  uncleaner<LoginResponseBody>(asLoginResponseBody)

// Request payloads:
export const wasChangeOtpPayload =
  uncleaner<ChangeOtpPayload>(asChangeOtpPayload)
export const wasChangePasswordPayload = uncleaner<ChangePasswordPayload>(
  asChangePasswordPayload
)
export const wasChangePin2IdPayload = uncleaner<ChangePin2IdPayload>(
  asChangePin2IdPayload
)
export const wasChangePin2Payload =
  uncleaner<ChangePin2Payload>(asChangePin2Payload)
export const wasChangeRecovery2IdPayload = uncleaner<ChangeRecovery2IdPayload>(
  asChangeRecovery2IdPayload
)
export const wasChangeRecovery2Payload = uncleaner<ChangeRecovery2Payload>(
  asChangeRecovery2Payload
)
export const wasChangeSecretPayload = uncleaner<ChangeSecretPayload>(
  asChangeSecretPayload
)
export const wasChangeUsernamePayload = uncleaner<ChangeUsernamePayload>(
  asChangeUsernamePayload
)
export const wasChangeVouchersPayload = uncleaner<ChangeVouchersPayload>(
  asChangeVouchersPayload
)
export const wasCreateKeysPayload =
  uncleaner<CreateKeysPayload>(asCreateKeysPayload)
export const wasCreateLoginPayload =
  uncleaner<CreateLoginPayload>(asCreateLoginPayload)

// Response payloads:
export const wasChallengeErrorPayload = uncleaner<ChallengeErrorPayload>(
  asChallengeErrorPayload
)
export const wasLobbyPayload = uncleaner<LobbyPayload>(asLobbyPayload)
export const wasLoginPayload = uncleaner<LoginPayload>(asLoginPayload)
export const wasMessagesPayload = uncleaner<MessagesPayload>(asMessagesPayload)
export const wasOtpErrorPayload = uncleaner<OtpErrorPayload>(asOtpErrorPayload)
export const wasOtpResetPayload = uncleaner<OtpResetPayload>(asOtpResetPayload)
export const wasPasswordErrorPayload = uncleaner<PasswordErrorPayload>(
  asPasswordErrorPayload
)
/** @deprecated The GUI provides its own localized strings now. */
export const wasQuestionChoicesPayload = uncleaner<QuestionChoicesPayload>(
  asQuestionChoicesPayload
)
export const wasRecovery2InfoPayload = uncleaner<Recovery2InfoPayload>(
  asRecovery2InfoPayload
)
export const wasUsernameInfoPayload = uncleaner<UsernameInfoPayload>(
  asUsernameInfoPayload
)

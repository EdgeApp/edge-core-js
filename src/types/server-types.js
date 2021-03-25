// @flow

import {
  type EdgeLoginMessage,
  type EdgePendingVoucher,
  type EdgeRecoveryQuestionChoice
} from './types.js'

// ---------------------------------------------------------------------
// internal Edge types
// ---------------------------------------------------------------------

/**
 * Edge-format encrypted data.
 */
export type EdgeBox = {
  encryptionType: number,
  data_base64: string,
  iv_hex: string
}

/**
 * Edge-format scrypt parameters.
 */
export type EdgeSnrp = {
  salt_hex: string,
  n: number,
  r: number,
  p: number
}

/**
 * The barcode creator uploads this request.
 */
export type EdgeLobbyRequest = {
  loginRequest?: { appId: string },
  publicKey: string, // base64
  timeout?: number
}

/**
 * The barcode scanner sends this reply (if the user approves).
 */
export type EdgeLobbyReply = {
  publicKey: string,
  box: EdgeBox
}

// ---------------------------------------------------------------------
// top-level request & response bodies
// ---------------------------------------------------------------------

/**
 * Data sent to authenticate with the login server.
 */
export type LoginRequestBody = {
  // The request payload:
  data?: mixed,

  // Common fields for all login methods:
  deviceDescription?: string,
  otp?: string,
  voucherId?: string,
  voucherAuth?: Uint8Array,

  // Secret-key login:
  loginId?: string,
  loginAuth?: Uint8Array,

  // Password login:
  userId?: string,
  passwordAuth?: string,

  // PIN login:
  pin2Id?: string,
  pin2Auth?: Uint8Array,

  // Recovery login:
  recovery2Id?: string,
  recovery2Auth?: Uint8Array[],

  // Messages:
  loginIds?: string[],

  // OTP reset:
  otpResetAuth?: string,

  // Legacy:
  did?: string,
  l1?: string,
  lp1?: string,
  lpin1?: Uint8Array,
  lra1?: string,
  recoveryAuth?: string // lra1
}

export type LoginResponseBody = {
  // The response payload:
  results?: mixed,

  // What type of response is this (success or failure)?:
  status_code: number,
  message: string
}

// ---------------------------------------------------------------------
// request payloads
// ---------------------------------------------------------------------

export type ChangeOtpPayload = {
  otpTimeout: number, // seconds
  otpKey: string
}

export type ChangePasswordPayload = {
  passwordAuth: string,
  passwordAuthBox: EdgeBox,
  passwordAuthSnrp: EdgeSnrp,
  passwordBox: EdgeBox,
  passwordKeySnrp: EdgeSnrp
}

export type ChangePin2Payload = {
  pin2Id?: string,
  pin2Auth?: Uint8Array,
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox: EdgeBox
}

export type ChangeRecovery2Payload = {
  recovery2Id: string,
  recovery2Auth: Uint8Array[],
  recovery2Box: EdgeBox,
  recovery2KeyBox: EdgeBox,
  question2Box: EdgeBox
}

export type ChangeSecretPayload = {
  loginAuthBox: EdgeBox,
  loginAuth: Uint8Array
}

export type ChangeVouchersPayload = {
  approvedVouchers?: string[],
  rejectedVouchers?: string[]
}

export type CreateKeysPayload = {
  keyBoxes: EdgeBox[],
  newSyncKeys: string[]
}

export type CreateLoginPayload = {
  appId: string,
  loginId: string, // base64
  parentBox?: EdgeBox

  // The creation payload can also include fields
  // from any of these other types, so the server should try
  // those cleaners one-by-one and incorporate the ones that work:
  // ...ChangeOtpPayload
  // ...ChangePasswordPayload
  // ...ChangePin2Payload
  // ...ChangeRecovery2Payload
  // ...ChangeSecretPayload
  // ...CreateKeysPayload
}

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

/**
 * Data sent back when looking up a login barcode.
 */
export type LobbyPayload = {
  request: EdgeLobbyRequest,
  replies: EdgeLobbyReply[]
}

/**
 * Data sent back upon successful login.
 */
export type LoginPayload = {
  // Identity:
  appId: string,
  created?: Date, // Not actually optional
  loginId: string,

  // Nested logins:
  children?: LoginPayload[],
  parentBox?: EdgeBox,

  // 2-factor login:
  otpKey?: string,
  otpResetDate?: Date,
  otpTimeout?: number,

  // Password login:
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN v2 login:
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox?: EdgeBox,

  // Recovery v2 login:
  question2Box?: EdgeBox,
  recovery2Box?: EdgeBox,
  recovery2KeyBox?: EdgeBox,

  // Secret-key login:
  loginAuthBox?: EdgeBox,

  // Voucher login:
  pendingVouchers: EdgePendingVoucher[],

  // Resources:
  keyBoxes?: EdgeBox[],
  mnemonicBox?: EdgeBox,
  rootKeyBox?: EdgeBox,
  syncKeyBox?: EdgeBox
}

/**
 * Account status information sent back by the login server.
 */
export type MessagesPayload = EdgeLoginMessage[]

/**
 * Returned when the 2fa authentication fails.
 */
export type OtpErrorPayload = {
  login_id?: string,
  otp_reset_auth?: string,
  otp_timeout_date?: Date,
  reason?: string,
  voucher_activates?: Date,
  voucher_auth?: Uint8Array,
  voucher_id?: string
}

/**
 * Returned when requesting a 2fa reset.
 */
export type OtpResetPayload = {
  otpResetDate: Date
}

/**
 * Returned when the password authentication fails.
 */
export type PasswordErrorPayload = {
  wait_seconds?: number
}

/**
 * A list of recovery questions the user can pick from.
 */
export type QuestionChoicesPayload = EdgeRecoveryQuestionChoice[]

/**
 * Returned when fetching the recovery questions for an account.
 */
export type Recovery2InfoPayload = {
  question2Box: EdgeBox
}

/**
 * Returned when fetching the password hashing options for an account.
 */
export type UsernameInfoPayload = {
  // Password login:
  passwordAuthSnrp?: EdgeSnrp,

  // Recovery v1 login:
  questionBox?: EdgeBox,
  questionKeySnrp?: EdgeSnrp,
  recoveryAuthSnrp?: EdgeSnrp
}

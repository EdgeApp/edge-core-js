// @flow

import {
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
  salt_hex: Uint8Array,
  n: number,
  r: number,
  p: number
}

/**
 * The barcode creator uploads this request.
 */
export type EdgeLobbyRequest = {
  loginRequest?: { appId: string },
  publicKey: Uint8Array,
  timeout?: number
}

/**
 * The barcode scanner sends this reply (if the user approves).
 */
export type EdgeLobbyReply = {
  publicKey: Uint8Array,
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
  loginId?: Uint8Array,
  loginAuth?: Uint8Array,

  // Password login:
  userId?: Uint8Array,
  passwordAuth?: Uint8Array,

  // PIN login:
  pin2Id?: Uint8Array,
  pin2Auth?: Uint8Array,

  // Recovery login:
  recovery2Id?: Uint8Array,
  recovery2Auth?: Uint8Array[],

  // Messages:
  loginIds?: Uint8Array[],

  // OTP reset:
  otpResetAuth?: string,

  // Legacy:
  did?: string,
  l1?: Uint8Array,
  lp1?: Uint8Array,
  lpin1?: Uint8Array,
  lra1?: Uint8Array,
  recoveryAuth?: Uint8Array // lra1
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
  otpKey: Uint8Array
}

export type ChangePasswordPayload = {
  passwordAuth: Uint8Array,
  passwordAuthBox: EdgeBox,
  passwordAuthSnrp: EdgeSnrp,
  passwordBox: EdgeBox,
  passwordKeySnrp: EdgeSnrp
}

export type ChangePin2Payload = {
  pin2Id?: Uint8Array,
  pin2Auth?: Uint8Array,
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox: EdgeBox
}

export type ChangeRecovery2Payload = {
  recovery2Id: Uint8Array,
  recovery2Auth: Uint8Array[],
  recovery2Box: EdgeBox,
  recovery2KeyBox: EdgeBox,
  question2Box: EdgeBox
}

export type ChangeSecretPayload = {
  loginAuthBox: EdgeBox,
  loginAuth: Uint8Array
}

export type ChangeUsernamePayload = {
  userId: Uint8Array,
  userTextBox: EdgeBox
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
  loginId: Uint8Array,
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
  created: Date,
  loginId: Uint8Array,

  // Nested logins:
  children?: LoginPayload[],
  parentBox?: EdgeBox,

  // 2-factor login:
  otpKey?: Uint8Array,
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

  // Username:
  userId?: Uint8Array,
  userTextBox?: EdgeBox,

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
export type MessagesPayload = Array<{
  loginId: Uint8Array,
  otpResetPending: boolean,
  pendingVouchers: EdgePendingVoucher[],
  recovery2Corrupt: boolean
}>

/**
 * Returned when the 2fa authentication fails.
 */
export type OtpErrorPayload = {
  login_id?: Uint8Array,
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

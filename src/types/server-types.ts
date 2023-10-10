import type { EdgePendingVoucher, EdgeRecoveryQuestionChoice } from './types'

// ---------------------------------------------------------------------
// internal Edge types
// ---------------------------------------------------------------------

/**
 * Edge-format encrypted data.
 */
export interface EdgeBox {
  encryptionType: number
  data_base64: Uint8Array
  iv_hex: Uint8Array
}

/**
 * Edge-format scrypt parameters.
 */
export interface EdgeSnrp {
  salt_hex: Uint8Array
  n: number
  r: number
  p: number
}

/**
 * The barcode creator uploads this request.
 */
export interface EdgeLobbyRequest {
  loginRequest?: { appId: string }
  publicKey: Uint8Array
  timeout?: number
}

/**
 * The barcode scanner sends this reply (if the user approves).
 */
export interface EdgeLobbyReply {
  publicKey: Uint8Array
  box: EdgeBox
}

// ---------------------------------------------------------------------
// top-level request & response bodies
// ---------------------------------------------------------------------

/**
 * Data sent to authenticate with the login server.
 */
export interface LoginRequestBody {
  // The request payload:
  data?: unknown

  // Common fields for all login methods:
  challengeId?: string
  deviceDescription?: string
  otp?: string
  syncToken?: string
  voucherId?: string
  voucherAuth?: Uint8Array

  // Secret-key login:
  loginId?: Uint8Array
  loginAuth?: Uint8Array

  // Password login:
  userId?: Uint8Array
  passwordAuth?: Uint8Array

  // PIN login:
  pin2Id?: Uint8Array
  pin2Auth?: Uint8Array

  // Recovery login:
  recovery2Id?: Uint8Array
  recovery2Auth?: Uint8Array[]

  // Messages:
  loginIds?: Uint8Array[]

  // OTP reset:
  otpResetAuth?: string

  // Legacy:
  did?: string
  l1?: Uint8Array
  lp1?: Uint8Array
  lpin1?: Uint8Array
  lra1?: Uint8Array
  recoveryAuth?: Uint8Array // lra1
}

export interface LoginResponseBody {
  // The response payload:
  results?: unknown

  // What of response is this (success or failure)?:
  status_code: number
  message: string
}

// ---------------------------------------------------------------------
// request payloads
// ---------------------------------------------------------------------

export interface ChangeOtpPayload {
  otpTimeout: number // seconds
  otpKey: Uint8Array
}

export interface ChangePasswordPayload {
  passwordAuth: Uint8Array
  passwordAuthBox: EdgeBox
  passwordAuthSnrp: EdgeSnrp
  passwordBox: EdgeBox
  passwordKeySnrp: EdgeSnrp
}

export interface ChangePin2IdPayload {
  pin2Id: Uint8Array
}

export interface ChangePin2Payload {
  pin2Id?: Uint8Array
  pin2Auth?: Uint8Array
  pin2Box?: EdgeBox
  pin2KeyBox?: EdgeBox
  pin2TextBox: EdgeBox
}

export interface ChangeRecovery2IdPayload {
  recovery2Id: Uint8Array
}

export interface ChangeRecovery2Payload {
  recovery2Id: Uint8Array
  recovery2Auth: Uint8Array[]
  recovery2Box: EdgeBox
  recovery2KeyBox: EdgeBox
  question2Box: EdgeBox
}

export interface ChangeSecretPayload {
  loginAuthBox: EdgeBox
  loginAuth: Uint8Array
}

export interface ChangeUsernamePayload {
  userId: Uint8Array
  userTextBox: EdgeBox

  // Also includes fields from these payloads if the login methods exist:
  // - ChangePasswordPayload
  // - ChangePin2IdPayload
  // - ChangeRecovery2IdPayload
}

export interface ChangeVouchersPayload {
  approvedVouchers?: string[]
  rejectedVouchers?: string[]
}

export interface CreateKeysPayload {
  keyBoxes: EdgeBox[]
  newSyncKeys: string[]
}

export interface CreateLoginPayload {
  appId: string
  loginId: Uint8Array
  parentBox?: EdgeBox

  // The creation payload can also include fields
  // from any of these other types, so the server should try
  // those cleaners one-by-one and incorporate the ones that work:
  // ...ChangeOtpPayload
  // ...ChangePasswordPayload
  // ...ChangePin2Payload
  // ...ChangeRecovery2Payload
  // ...ChangeSecretPayload
  // ...ChangeUsernamePayload
  // ...CreateKeysPayload
}

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

/**
 * Data sent back when logging in requires a CAPTCHA.
 */
export interface ChallengeErrorPayload {
  challengeId: string
  challengeUri: string
}

/**
 * Data sent back when looking up a login barcode.
 */
export interface LobbyPayload {
  request: EdgeLobbyRequest
  replies: EdgeLobbyReply[]
}

/**
 * Data sent back upon successful login.
 */
export interface LoginPayload {
  // Identity:
  appId: string
  created: Date
  loginId: Uint8Array
  syncToken?: string

  // Nested logins:
  children?: LoginPayload[]
  parentBox?: EdgeBox

  // 2-factor login:
  otpKey?: Uint8Array | true
  otpResetDate?: Date
  otpTimeout?: number

  // Password login:
  passwordAuthBox?: EdgeBox
  passwordAuthSnrp?: EdgeSnrp
  passwordBox?: EdgeBox | true
  passwordKeySnrp?: EdgeSnrp

  // PIN v2 login:
  pin2Box?: EdgeBox | true
  pin2KeyBox?: EdgeBox
  pin2TextBox?: EdgeBox

  // Recovery v2 login:
  question2Box?: EdgeBox
  recovery2Box?: EdgeBox | true
  recovery2KeyBox?: EdgeBox

  // Secret-key login:
  loginAuthBox?: EdgeBox

  // Username:
  userId?: Uint8Array
  userTextBox?: EdgeBox

  // Voucher login:
  pendingVouchers: EdgePendingVoucher[]

  // Resources:
  keyBoxes?: EdgeBox[]
  mnemonicBox?: EdgeBox
  rootKeyBox?: EdgeBox
  syncKeyBox?: EdgeBox
}

/**
 * Account status information sent back by the login server.
 */
export type MessagesPayload = Array<{
  loginId: Uint8Array
  otpResetPending: boolean
  pendingVouchers: EdgePendingVoucher[]
  recovery2Corrupt: boolean
}>

/**
 * Returned when the 2fa authentication fails.
 */
export interface OtpErrorPayload {
  // This should usually be present:
  login_id?: Uint8Array

  // Use this to request an OTP reset (if enabled):
  otp_reset_auth?: string

  // Set if an OTP reset has already been requested:
  otp_timeout_date?: Date

  // We might also get a different reason:
  reason: 'ip' | 'otp'

  // We might also get a login voucher:
  voucher_activates?: Date
  voucher_auth?: Uint8Array
  voucher_id?: string
}

/**
 * Returned when requesting a 2fa reset.
 */
export interface OtpResetPayload {
  otpResetDate: Date
}

/**
 * Returned when the password authentication fails.
 */
export interface PasswordErrorPayload {
  wait_seconds?: number
}

/**
 * A list of recovery questions the user can pick from.
 * @deprecated The GUI provides its own localized strings now.
 */
export type QuestionChoicesPayload = EdgeRecoveryQuestionChoice[]

/**
 * Returned when fetching the recovery questions for an account.
 */
export interface Recovery2InfoPayload {
  question2Box: EdgeBox
}

/**
 * Returned when fetching the password hashing options for an account.
 */
export interface UsernameInfoPayload {
  loginId: Uint8Array

  // Password login:
  passwordAuthSnrp?: EdgeSnrp

  // Recovery v1 login:
  questionBox?: EdgeBox
  questionKeySnrp?: EdgeSnrp
  recoveryAuthSnrp?: EdgeSnrp
}

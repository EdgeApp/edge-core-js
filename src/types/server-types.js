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
  voucherAuth?: string,

  // Secret-key login:
  loginId?: string,
  loginAuth?: string,

  // Password login:
  userId?: string,
  passwordAuth?: string,

  // PIN login:
  pin2Id?: string,
  pin2Auth?: string,

  // Recovery login:
  recovery2Id?: string,
  recovery2Auth?: string[]
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
  pin2Auth?: string,
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox: EdgeBox
}

export type ChangeRecovery2Payload = {
  recovery2Id: string,
  recovery2Auth: string[],
  recovery2Box: EdgeBox,
  recovery2KeyBox: EdgeBox,
  question2Box: EdgeBox
}

export type ChangeSecretPayload = {
  loginAuthBox: EdgeBox,
  loginAuth: string
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

export type LoginRequestPayload =
  | ChangeOtpPayload
  | ChangePasswordPayload
  | ChangePin2Payload
  | ChangeRecovery2Payload
  | ChangeSecretPayload
  | CreateKeysPayload
  | CreateLoginPayload

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
  created?: Date,
  loginId: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: Date,
  otpTimeout?: number,
  pendingVouchers: EdgePendingVoucher[],

  // Return logins:
  loginAuthBox?: EdgeBox,
  parentBox?: EdgeBox,

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

  // Resources:
  children?: LoginPayload[],
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
 * Returned when requesting a 2fa reset.
 */
export type OtpResetPayload = {
  otpResetDate: Date
}

/**
 * A list of recovery questions the user can pick from.
 */
export type QuestionChoicesPayload = EdgeRecoveryQuestionChoice[]

/**
 * Returned when fetching the recovery questions for an account.
 */
export type StartRecoveryPayload = {
  question2Box: EdgeBox
}

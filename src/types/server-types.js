// @flow

import { type EdgePendingVoucher } from './types.js'

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

// ---------------------------------------------------------------------
// top-level request & response bodies
// ---------------------------------------------------------------------

/**
 * Data sent to authenticate with the login server.
 */
export type LoginRequest = {
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

export type LoginResponse = {
  // The response payload:
  results?: mixed,

  // What type of response is this (success or failure)?:
  status_code: number,
  message: string
}

// ---------------------------------------------------------------------
// request payloads
// ---------------------------------------------------------------------

export type PasswordPayload = {
  passwordAuth: string,
  passwordAuthBox: EdgeBox,
  passwordAuthSnrp: EdgeSnrp,
  passwordBox: EdgeBox,
  passwordKeySnrp: EdgeSnrp
}

export type Pin2DisablePayload = {
  pin2Id: void,
  pin2Auth: void,
  pin2Box: void,
  pin2KeyBox: void,
  pin2TextBox: EdgeBox
}

export type Pin2EnablePayload = {
  pin2Id: string,
  pin2Auth: string,
  pin2Box: EdgeBox,
  pin2KeyBox: EdgeBox,
  pin2TextBox: EdgeBox
}

export type Recovery2Payload = {
  recovery2Id: string,
  recovery2Auth: string[],
  recovery2Box: EdgeBox,
  recovery2KeyBox: EdgeBox,
  question2Box: EdgeBox
}

export type SecretPayload = {
  loginAuthBox: EdgeBox,
  loginAuth: string
}

// ---------------------------------------------------------------------
// response payloads
// ---------------------------------------------------------------------

/**
 * Data sent back by the auth server.
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

export type OtpResetPayload = {
  otpResetDate: Date
}

export type StartRecoveryPayload = {
  question2Box: EdgeBox
}

// ---------------------------------------------------------------------
// lobby subsystem
// ---------------------------------------------------------------------

/**
 * The barcode creator uploads this request.
 */
export type LobbyRequest = {
  loginRequest?: { appId: string },
  publicKey: string, // base64
  timeout?: number
}

/**
 * The barcode scanner sends this reply (if the user approves).
 */
export type LobbyReply = {
  publicKey: string,
  box: EdgeBox
}

/**
 * The server holds the request & replies for each lobby ID,
 * and returns them in this format.
 */
export type LobbyPayload = {
  request: LobbyRequest,
  replies: LobbyReply[]
}

// @flow

import { type Cleaner, asDate, asObject, asOptional, asString } from 'cleaners'

import {
  type EdgePendingVoucher,
  type EdgeWalletInfo,
  type EdgeWalletInfoFull
} from '../../types/types.js'
import { type LoginStash } from './login-stash.js'

/**
 * Data sent to authenticate with the login server.
 */
export type LoginRequest = {
  // The request payload:
  data?: any,

  // Common fields for all login methods:
  deviceDescription?: string,
  otp?: string,
  voucherId?: string,
  voucherAuth?: string,

  // Auth key login:
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

// Login data decrypted into memory.
export type LoginTree = {
  // Identity:
  appId: string,
  created?: Date,
  lastLogin: Date,
  loginId: string,
  loginKey: Uint8Array,
  userId?: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: Date,
  otpTimeout?: number,
  pendingVouchers: EdgePendingVoucher[],

  // Login methods:
  loginAuth?: Uint8Array,
  passwordAuth?: Uint8Array,
  pin?: string,
  pin2Key?: Uint8Array,
  recovery2Key?: Uint8Array,

  // Resources:
  children: LoginTree[],
  keyInfos: EdgeWalletInfo[]
}

export type LoginType =
  | 'edgeLogin'
  | 'keyLogin'
  | 'newAccount'
  | 'passwordLogin'
  | 'pinLogin'
  | 'recoveryLogin'

export type AppIdMap = { [walletId: string]: string[] }

export type LoginKit = {
  loginId: string,
  login: $Shape<LoginTree>,
  server?: any,
  serverMethod?: string,
  serverPath: string,
  stash: $Shape<LoginStash>
}

export type WalletInfoFullMap = { [walletId: string]: EdgeWalletInfoFull }

export const asPendingVoucher: Cleaner<EdgePendingVoucher> = asObject({
  voucherId: asString,
  activates: asDate,
  created: asDate,
  ip: asString,
  ipDescription: asString,
  deviceDescription: asOptional(asString)
})

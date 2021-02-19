// @flow

import { type LoginRequestPayload } from '../../types/server-types.js'
import {
  type EdgePendingVoucher,
  type EdgeWalletInfo,
  type EdgeWalletInfoFull
} from '../../types/types.js'
import { type LoginStash } from './login-stash.js'

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
  server?: LoginRequestPayload,
  serverMethod?: string,
  serverPath: string,
  stash: $Shape<LoginStash>
}

export type WalletInfoFullMap = { [walletId: string]: EdgeWalletInfoFull }

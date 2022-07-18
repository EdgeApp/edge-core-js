// @flow

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
  loginId: Uint8Array,
  loginKey: Uint8Array,

  // 2-factor:
  otpKey?: Uint8Array,
  otpResetDate?: Date,
  otpTimeout?: number,
  pendingVouchers: EdgePendingVoucher[],

  // Login methods:
  loginAuth?: Uint8Array,
  passwordAuth?: Uint8Array,
  pin?: string,
  pin2Key?: Uint8Array,
  recovery2Key?: Uint8Array,

  // Username:
  userId?: Uint8Array,
  username?: string,

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
  loginId: Uint8Array,
  login: $Shape<LoginTree>,
  server?: mixed,
  serverMethod?: string,
  serverPath: string,
  stash: $Shape<LoginStash>
}

/**
 * A stash for a specific child account,
 * along with its containing tree.
 */
export type StashLeaf = {
  stash: LoginStash,
  stashTree: LoginStash
}

export type WalletInfoFullMap = { [walletId: string]: EdgeWalletInfoFull }

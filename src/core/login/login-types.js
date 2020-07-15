// @flow

import {
  type EdgeWalletInfo,
  type EdgeWalletInfoFull
} from '../../types/types.js'
import { type LoginStash } from './login-stash.js'

// Login data decrypted into memory.
export type LoginTree = {
  // Identity:
  appId: string,
  created?: Date,
  loginId: string,
  loginKey: Uint8Array,
  userId: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: Date,
  otpTimeout?: number,

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

export type AppIdMap = { [walletId: string]: string[] }

export type LoginKit = {
  loginId: string,
  login: any,
  server?: any,
  serverMethod?: string,
  serverPath: string,
  stash: $Shape<LoginStash>
}

export type WalletInfoFullMap = { [walletId: string]: EdgeWalletInfoFull }

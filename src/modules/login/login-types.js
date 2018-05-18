// @flow

import type { EdgeWalletInfo } from '../../edge-core-index.js'
import type { JsonBox } from '../../util/crypto/crypto.js'
import type { JsonSnrp } from '../scrypt/scrypt-pixie.js'

export type LoginReply = Object
export type LoginTree = Object
export type ServerPayload = Object

/**
 * The login data we store on disk.
 */
export type LoginStash = {
  // Basic account info:
  appId?: string, // Not actually optional
  loginAuthBox?: JsonBox,
  loginId?: string, // Not actually optional
  userId?: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Offline password logins:
  passwordAuthBox?: JsonBox,
  passwordBox?: JsonBox,
  passwordKeySnrp?: JsonSnrp,

  // PIN login:
  pin2TextBox?: JsonBox,
  pin2Key?: string,

  // Recovery login:
  recovery2Key?: string,

  // Resources:
  children?: Array<LoginStash>,
  keyBoxes?: Array<JsonBox>,
  mnemonicBox?: JsonBox,
  parentBox?: JsonBox,
  rootKeyBox?: JsonBox,
  syncKeyBox?: JsonBox
}

export type AppIdMap = { [walletId: string]: Array<string> }

export interface LoginKit {
  loginId: string;
  login: LoginTree;
  server: ServerPayload;
  serverMethod?: string;
  serverPath: string;
  stash: LoginStash;
}

// Helper for defining specific key types.
// Use `EdgeWalletInfo` for generic wallet infos:
interface WalletInfo<K = {}> {
  type: string;
  id: string;
  keys: K;
}

export interface StorageKeys {
  dataKey?: string; // base64
  syncKey?: string; // base64
}
export type StorageWalletInfo = WalletInfo<StorageKeys>

export type WalletInfoMap = { [walletId: string]: EdgeWalletInfo }

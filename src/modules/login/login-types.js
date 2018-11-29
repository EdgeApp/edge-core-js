// @flow

import { type EdgeWalletInfo } from '../../types/types.js'
import { type JsonBox } from '../../util/crypto/crypto.js'
import { type JsonSnrp } from '../scrypt/scrypt-pixie.js'

/**
 * Data sent back by the auth server.
 */
export type LoginReply = {
  appId: string,
  loginAuthBox?: JsonBox,
  loginId: string,

  // 2-factor:
  otpResetDate?: string,
  otpTimeout?: number,

  // Offline password logins:
  passwordAuthBox?: JsonBox,
  passwordAuthSnrp?: JsonBox,
  passwordBox?: JsonBox,
  passwordKeySnrp?: JsonSnrp,

  // PIN login:
  pin2Box?: JsonBox,
  pin2KeyBox?: JsonBox,
  pin2TextBox?: JsonBox,

  // Recovery login:
  question2Box?: JsonBox,
  recovery2Box?: JsonBox,
  recovery2KeyBox?: JsonBox,

  // Resources:
  children?: Array<LoginReply>,
  keyBoxes?: Array<JsonBox>,
  mnemonicBox?: JsonBox,
  parentBox?: JsonBox,
  rootKeyBox?: JsonBox,
  syncKeyBox?: JsonBox
}

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
  passwordAuthSnrp?: JsonSnrp,
  passwordBox?: JsonBox,
  passwordKeySnrp?: JsonSnrp,

  // PIN login:
  pin2Key?: string,
  pin2TextBox?: JsonBox,

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

// Login data decrypted into memory.
export type LoginTree = {
  appId: string,
  loginAuth?: Uint8Array,
  loginId: string,
  loginKey: Uint8Array,
  userId: string,
  username?: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Login methods:
  passwordAuth?: Uint8Array,
  pin?: string,
  pin2Key?: Uint8Array,
  recovery2Key?: Uint8Array,

  // Resources:
  keyInfos: Array<EdgeWalletInfo>,
  children: Array<LoginTree>
}

export type AppIdMap = { [walletId: string]: Array<string> }

export type LoginKit = {
  loginId: string,
  login: Object,
  server?: Object,
  serverMethod?: string,
  serverPath: string,
  stash: LoginStash
}

// Helper for defining specific key types.
// Use `EdgeWalletInfo` for generic wallet infos:
type WalletInfo<KeysType = {}> = {
  type: string,
  id: string,
  keys: KeysType
}

export interface StorageKeys {
  dataKey?: string; // base64
  syncKey?: string; // base64
}
export type StorageWalletInfo = WalletInfo<StorageKeys>

export type WalletInfoMap = { [walletId: string]: EdgeWalletInfo }

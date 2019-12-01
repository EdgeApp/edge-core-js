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
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Offline password logins:
  passwordAuthBox?: JsonBox,
  passwordAuthSnrp?: JsonSnrp,
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
  children?: LoginReply[],
  keyBoxes?: JsonBox[],
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
  children?: LoginStash[],
  keyBoxes?: JsonBox[],
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
  keyInfos: EdgeWalletInfo[],
  children: LoginTree[]
}

export type AppIdMap = { [walletId: string]: string[] }

export type LoginKit = {
  loginId: string,
  login: any,
  server?: any,
  serverMethod?: string,
  serverPath: string,
  stash: LoginStash
}

export type WalletInfoMap = { [walletId: string]: EdgeWalletInfo }

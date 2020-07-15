// @flow

import { type EdgeBox } from '../../util/crypto/crypto.js'
import { type EdgeSnrp } from '../scrypt/scrypt-pixie.js'

/**
 * Data sent back by the auth server.
 */
export type LoginReply = {
  appId: string,
  loginAuthBox?: EdgeBox,
  loginId: string,

  // 2-factor:
  otpKey?: string,
  otpResetDate?: string,
  otpTimeout?: number,

  // Offline password logins:
  passwordAuthBox?: EdgeBox,
  passwordAuthSnrp?: EdgeSnrp,
  passwordBox?: EdgeBox,
  passwordKeySnrp?: EdgeSnrp,

  // PIN login:
  pin2Box?: EdgeBox,
  pin2KeyBox?: EdgeBox,
  pin2TextBox?: EdgeBox,

  // Recovery login:
  question2Box?: EdgeBox,
  recovery2Box?: EdgeBox,
  recovery2KeyBox?: EdgeBox,

  // Resources:
  children?: LoginReply[],
  keyBoxes?: EdgeBox[],
  mnemonicBox?: EdgeBox,
  parentBox?: EdgeBox,
  rootKeyBox?: EdgeBox,
  syncKeyBox?: EdgeBox
}

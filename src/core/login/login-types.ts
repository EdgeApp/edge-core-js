import {
  EdgePendingVoucher,
  EdgeWalletInfo,
  EdgeWalletInfoFull
} from '../../types/types'
import { LoginStash } from './login-stash'

// Login data decrypted into memory.
export interface LoginTree {
  // Identity:
  appId: string
  created?: Date
  lastLogin: Date
  loginId: Uint8Array
  loginKey: Uint8Array

  // 2-factor:
  otpKey?: Uint8Array
  otpResetDate?: Date
  otpTimeout?: number
  pendingVouchers: EdgePendingVoucher[]

  // Login methods:
  loginAuth?: Uint8Array
  passwordAuth?: Uint8Array
  pin?: string
  pin2Key?: Uint8Array
  recovery2Key?: Uint8Array

  // Username:
  userId?: Uint8Array
  username?: string

  // Resources:
  children: LoginTree[]
  keyInfos: EdgeWalletInfo[]
}

export type LoginType =
  | 'edgeLogin'
  | 'keyLogin'
  | 'newAccount'
  | 'passwordLogin'
  | 'pinLogin'
  | 'recoveryLogin'

export interface AppIdMap {
  [walletId: string]: string[]
}

export interface LoginKit {
  loginId: Uint8Array
  login: Partial<LoginTree>
  server?: unknown
  serverMethod?: string
  serverPath: string
  stash: Partial<LoginStash>
}

/**
 * A stash for a specific child account,
 * along with its containing tree.
 */
export interface StashLeaf {
  stash: LoginStash
  stashTree: LoginStash
}

export interface WalletInfoFullMap {
  [walletId: string]: EdgeWalletInfoFull
}

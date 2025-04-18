import { asObject, asString, uncleaner } from 'cleaners'

import {
  EdgePendingVoucher,
  EdgeWalletInfo,
  EdgeWalletInfoFull
} from '../../types/types'
import { asJsonObject } from '../../util/file-helpers'
import { LoginStash } from './login-stash'

/**
 * A key that decrypts a login stash.
 */
export interface SessionKey {
  /** The login that this key belongs to. This may be a child login. */
  loginId: Uint8Array

  /** The decryption key. */
  loginKey: Uint8Array
}

/**
 * The login data decrypted into memory.
 * @deprecated Use `LoginStash` instead and decrypt it at the point of use.
 * This is an ongoing refactor to remove this type.
 */
export interface LoginTree {
  isRoot: boolean

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
}

export type LoginType =
  | 'edgeLogin'
  | 'keyLogin'
  | 'newAccount'
  | 'passwordLogin'
  | 'pinLogin'
  | 'recoveryLogin'

export interface LoginKit {
  /** The change will affect the node with this ID. */
  loginId: Uint8Array

  /**
   * The login-server payload that achieves the change.
   * Not all routes take a payload, such as the DELETE routes.
   */
  server: object | undefined

  /**
   * The login-server HTTP method that makes the change.
   * Defaults to "POST" if not present.
   */
  serverMethod?: string
  serverPath: string

  /**
   * A diff to apply to the stash tree, starting at the `loginId` node.
   * TODO: Update the login server to return a diff on every endpoint,
   * so we can get rid of this.
   */
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

export const asEdgeWalletInfo = asObject<EdgeWalletInfo>({
  id: asString,
  keys: asJsonObject,
  type: asString
})

export const wasEdgeWalletInfo = uncleaner(asEdgeWalletInfo)

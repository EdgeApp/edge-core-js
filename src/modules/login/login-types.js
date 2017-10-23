// @flow
import type { AbcWalletInfo } from 'airbitz-core-types'

export type JsonBox = Object
export type JsonSnrp = Object
export type LoginReply = Object
export type LoginStash = Object
export type LoginTree = Object
export type ServerPayload = Object

export type AppIdMap = { [walletId: string]: Array<string> }

export interface LoginKit {
  loginId?: string; // Really!? Doesn't seem optional
  login: LoginTree;
  server: ServerPayload;
  serverPath: string;
  stash: LoginStash;
}

// Helper for defining specific key types.
// Use `AbcWalletInfo` for generic wallet infos:
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

export type WalletInfoMap = { [walletId: string]: AbcWalletInfo }

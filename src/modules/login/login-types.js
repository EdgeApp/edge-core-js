// @flow

export type JsonBox = Object
export type JsonSnrp = Object
export type LoginReply = Object
export type LoginStash = Object
export type LoginTree = Object
export type ServerPayload = Object

export interface LoginKit {
  loginId?: string; // Really!? Doesn't seem optional
  login: LoginTree;
  server: ServerPayload;
  serverPath: string;
  stash: LoginStash;
}

export interface WalletInfo<K = {}> {
  type: string;
  id: string;
  keys: K;
}

export interface StorageKeys {
  dataKey?: string; // base64
  syncKey?: string; // base64
}

export type StorageWalletInfo = WalletInfo<StorageKeys>

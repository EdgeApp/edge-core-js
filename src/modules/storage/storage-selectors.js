// @flow

import type { EdgeIo } from '../../edge-core-index.js'
import { hmacSha256 } from '../../util/crypto/crypto.js'
import { base58, utf8 } from '../../util/encoding.js'
import type { RootState } from '../root-reducer.js'
import { RepoFolder } from './repoFolder.js'

export function getStorageWalletLastChanges (
  state: RootState,
  walletId: string
) {
  return state.storageWallets[walletId].lastChanges
}

export function getStorageWalletFolder (state: RootState, walletId: string) {
  return state.storageWallets[walletId].paths.folder
}

export function getStorageWalletLocalFolder (
  state: RootState,
  walletId: string
) {
  return state.storageWallets[walletId].localFolder
}

export function makeStorageWalletLocalEncryptedFolder (
  state: RootState,
  walletId: string,
  io: EdgeIo
) {
  return new RepoFolder(
    io,
    state.storageWallets[walletId].paths.dataKey,
    state.storageWallets[walletId].localFolder
  )
}

export function hashStorageWalletFilename (
  state: RootState,
  walletId: string,
  data: string
) {
  const dataKey = state.storageWallets[walletId].paths.dataKey
  return base58.stringify(hmacSha256(utf8.parse(data), dataKey))
}

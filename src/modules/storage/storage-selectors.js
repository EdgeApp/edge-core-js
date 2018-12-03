// @flow

import { type Disklet, type DiskletFolder, downgradeDisklet } from 'disklet'

import { type EdgeIo } from '../../types/types.js'
import { hmacSha256 } from '../../util/crypto/crypto.js'
import { base58, utf8 } from '../../util/encoding.js'
import { type RootState } from '../root-reducer.js'
import { encryptDisklet } from './encrypt-disklet.js'

export function getStorageWalletLastChanges (
  state: RootState,
  walletId: string
) {
  return state.storageWallets[walletId].lastChanges
}

export function getStorageWalletDisklet (
  state: RootState,
  walletId: string
): Disklet {
  return state.storageWallets[walletId].paths.disklet
}

export function getStorageWalletLocalDisklet (
  state: RootState,
  walletId: string
): Disklet {
  return state.storageWallets[walletId].localDisklet
}

export function makeStorageWalletLocalEncryptedDisklet (
  state: RootState,
  walletId: string,
  io: EdgeIo
): Disklet {
  return encryptDisklet(
    io,
    state.storageWallets[walletId].paths.dataKey,
    state.storageWallets[walletId].localDisklet
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

// deprecated:

export function getStorageWalletFolder (
  state: RootState,
  walletId: string
): DiskletFolder {
  return downgradeDisklet(state.storageWallets[walletId].paths.disklet)
}

export function getStorageWalletLocalFolder (
  state: RootState,
  walletId: string
): DiskletFolder {
  return downgradeDisklet(state.storageWallets[walletId].localDisklet)
}

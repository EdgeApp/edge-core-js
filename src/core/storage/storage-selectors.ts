import { Disklet } from 'disklet'

import { EdgeIo } from '../../types/types'
import { hmacSha256 } from '../../util/crypto/hashes'
import { base58, utf8 } from '../../util/encoding'
import { RootState } from '../root-reducer'
import { encryptDisklet } from './encrypt-disklet'

export function getStorageWalletLastChanges(
  state: RootState,
  walletId: string
): string[] {
  return state.storageWallets[walletId].lastChanges
}

export function getStorageWalletDisklet(
  state: RootState,
  walletId: string
): Disklet {
  return state.storageWallets[walletId].paths.disklet
}

export function getStorageWalletLocalDisklet(
  state: RootState,
  walletId: string
): Disklet {
  return state.storageWallets[walletId].localDisklet
}

export function makeStorageWalletLocalEncryptedDisklet(
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

export function hashStorageWalletFilename(
  state: RootState,
  walletId: string,
  data: string
): string {
  const dataKey = state.storageWallets[walletId].paths.dataKey
  return base58.stringify(hmacSha256(utf8.parse(data), dataKey))
}

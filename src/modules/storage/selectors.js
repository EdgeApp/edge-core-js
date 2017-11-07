import { hmacSha256 } from '../../util/crypto/crypto.js'
import { base58, utf8 } from '../../util/encoding.js'
import { RepoFolder } from './repoFolder.js'

export function getStorageWalletLastChanges (state, keyId) {
  return state.storageWallets[keyId].lastChanges
}

export function getStorageWalletFolder (state, keyId) {
  return state.storageWallets[keyId].paths.folder
}

export function getStorageWalletLocalFolder (state, keyId) {
  return state.storageWallets[keyId].localFolder
}

export function getStorageWalletLocalEncryptedFolder (state, keyId, io) {
  return new RepoFolder(
    io,
    state.storageWallets[keyId].paths.dataKey,
    state.storageWallets[keyId].localFolder
  )
}

export function hashStorageWalletFilename (state, keyId, data) {
  const dataKey = state.storageWallets[keyId].paths.dataKey
  return base58.stringify(hmacSha256(utf8.parse(data), dataKey))
}

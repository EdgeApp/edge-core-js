import { wrapObject } from '../util/api.js'
import { makeStorageState } from './storageState.js'

export function makeStorageWallet (keyInfo, opts) {
  const { io } = opts

  return makeStorageState(keyInfo, opts).then(state =>
    wrapObject(io.log, 'StorageWallet', makeStorageWalletApi(state))
  )
}

export function makeStorageWalletApi (state) {
  const { keyInfo: { id, type, keys } } = state

  return {
    // Broken-out key info:
    id,
    type,
    keys,

    // Folders:
    folder: state.folder,
    localFolder: state.localFolder,

    sync () {
      return state.sync()
    }
  }
}

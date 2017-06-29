import { addStorageWallet, syncStorageWallet } from '../redux/actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastSync,
  getStorageWalletLocalFolder
} from '../redux/selectors.js'
import { createReaction } from '../util/reaction.js'
import { wrapObject } from '../util/api.js'

export function makeStorageWallet (keyInfo, opts) {
  const { io, callbacks = {} } = opts
  const { redux } = io

  return redux
    .dispatch(addStorageWallet(keyInfo))
    .then(() =>
      wrapObject(
        io.onError,
        'StorageWallet',
        makeStorageWalletApi(redux, keyInfo, callbacks)
      )
    )
}

export function makeStorageWalletApi (redux, keyInfo, callbacks) {
  const { id, type, keys } = keyInfo
  const { onDataChanged } = callbacks

  if (onDataChanged) {
    redux.dispatch(
      createReaction(
        state => getStorageWalletLastSync(state, id),
        onDataChanged
      )
    )
  }

  return {
    // Broken-out key info:
    id,
    type,
    keys,

    // Folders:
    get folder () {
      return getStorageWalletFolder(redux.getState(), id)
    },

    get localFolder () {
      return getStorageWalletLocalFolder(redux.getState(), id)
    },

    sync () {
      return redux.dispatch(syncStorageWallet(id))
    }
  }
}

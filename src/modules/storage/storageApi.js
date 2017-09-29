import { wrapObject } from '../../util/api.js'
import { createReaction } from '../../util/redux/reaction.js'
import { addStorageWallet, syncStorageWallet } from '../actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastSync,
  getStorageWalletLocalFolder
} from '../selectors.js'

export function makeStorageWallet (keyInfo, opts) {
  const { coreRoot, callbacks = {} } = opts
  const { redux } = coreRoot

  return redux
    .dispatch(addStorageWallet(keyInfo))
    .then(() =>
      wrapObject(
        coreRoot.onError,
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

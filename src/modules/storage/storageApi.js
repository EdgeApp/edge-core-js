// @flow
import { wrapObject } from '../../util/api.js'
import { createReaction } from '../../util/redux/reaction.js'
import { addStorageWallet, syncStorageWallet } from '../actions.js'
import type { StorageWalletInfo } from '../login/login-types.js'
import type { ApiInput } from '../root.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastSync,
  getStorageWalletLocalFolder
} from '../selectors.js'

export function makeStorageWallet (keyInfo: StorageWalletInfo, opts: any) {
  const { callbacks = {} } = opts
  const ai: ApiInput = opts.ai
  const { dispatch } = ai.props

  const promise: any = dispatch(addStorageWallet(keyInfo, ai.props.onError))
  return promise.then(() =>
    wrapObject('StorageWallet', makeStorageWalletApi(ai, keyInfo, callbacks))
  )
}

export function makeStorageWalletApi (
  ai: ApiInput,
  keyInfo: StorageWalletInfo,
  callbacks: any
) {
  const { dispatch } = ai.props
  const { id, type, keys } = keyInfo
  const { onDataChanged } = callbacks

  if (onDataChanged) {
    dispatch(
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
      return getStorageWalletFolder(ai.props.state, id)
    },

    get localFolder () {
      return getStorageWalletLocalFolder(ai.props.state, id)
    },

    sync () {
      return dispatch(syncStorageWallet(id))
    }
  }
}

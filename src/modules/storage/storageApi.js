// @flow

import { wrapObject } from '../../util/api.js'
import { createReaction } from '../../util/redux/reaction.js'
import type { StorageWalletInfo } from '../login/login-types.js'
import type { ApiInput } from '../root.js'
import { addStorageWallet, syncStorageWallet } from './actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastChanges,
  getStorageWalletLocalFolder
} from './selectors.js'

export function makeStorageWallet (keyInfo: StorageWalletInfo, opts: any) {
  const { callbacks = {} } = opts
  const ai: ApiInput = opts.ai
  const { dispatch } = ai.props

  const promise: any = dispatch(
    addStorageWallet(keyInfo, ai.props.onError, ai.props.io)
  )
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
        state => getStorageWalletLastChanges(state, id),
        changes => onDataChanged(changes)
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

    async sync (): Promise<void> {
      await dispatch(syncStorageWallet(id, ai.props.io))
    }
  }
}

// @flow

import { createReaction } from '../../util/redux/reaction.js'
import type { StorageWalletInfo } from '../login/login-types.js'
import type { ApiInput } from '../root.js'
import { syncStorageWallet } from './storage-actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLastChanges,
  getStorageWalletLocalFolder
} from './storage-selectors.js'

export function makeStorageWalletApi (
  ai: ApiInput,
  walletInfo: StorageWalletInfo,
  callbacks: any
) {
  const { dispatch } = ai.props
  const { id, type, keys } = walletInfo
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

    async sync (): Promise<mixed> {
      await syncStorageWallet(ai, id)
    }
  }
}

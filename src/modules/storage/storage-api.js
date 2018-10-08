// @flow

import { type StorageWalletInfo } from '../login/login-types.js'
import { type ApiInput } from '../root.js'
import { syncStorageWallet } from './storage-actions.js'
import {
  getStorageWalletFolder,
  getStorageWalletLocalFolder
} from './storage-selectors.js'

export function makeStorageWalletApi (
  ai: ApiInput,
  walletInfo: StorageWalletInfo
) {
  const { id, type, keys } = walletInfo

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

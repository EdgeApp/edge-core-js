// @flow

import { type Disklet } from 'disklet'

import { type StorageWalletInfo } from '../login/login-types.js'
import { type ApiInput } from '../root.js'
import { syncStorageWallet } from './storage-actions.js'
import {
  getStorageWalletDisklet,
  getStorageWalletFolder,
  getStorageWalletLocalDisklet,
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
    get disklet (): Disklet {
      return getStorageWalletDisklet(ai.props.state, id)
    },

    get localDisklet (): Disklet {
      return getStorageWalletLocalDisklet(ai.props.state, id)
    },

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

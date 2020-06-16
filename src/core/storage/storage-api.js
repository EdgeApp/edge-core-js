// @flow

import { type Disklet } from 'disklet'

import { type EdgeWalletInfo, type JsonObject } from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import { syncStorageWallet } from './storage-actions.js'
import {
  getStorageWalletDisklet,
  getStorageWalletLocalDisklet
} from './storage-selectors.js'

export type EdgeStorageWallet = {
  +id: string,
  +keys: JsonObject,
  +type: string,
  +disklet: Disklet,
  +localDisklet: Disklet,
  sync(): Promise<void>
}

export function makeStorageWalletApi(
  ai: ApiInput,
  walletInfo: EdgeWalletInfo
): EdgeStorageWallet {
  const { id, type, keys } = walletInfo

  return {
    // Broken-out key info:
    id,
    type,
    keys,

    // Folders:
    get disklet(): Disklet {
      return getStorageWalletDisklet(ai.props.state, id)
    },

    get localDisklet(): Disklet {
      return getStorageWalletLocalDisklet(ai.props.state, id)
    },

    async sync(): Promise<void> {
      await syncStorageWallet(ai, id)
    }
  }
}

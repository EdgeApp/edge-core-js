import { Disklet } from 'disklet'

import { EdgeWalletInfo, JsonObject } from '../../types/types'
import { ApiInput } from '../root-pixie'
import { syncStorageWallet } from './storage-actions'
import {
  getStorageWalletDisklet,
  getStorageWalletLocalDisklet
} from './storage-selectors'

export interface EdgeStorageWallet {
  readonly id: string
  readonly keys: JsonObject
  readonly type: string
  readonly disklet: Disklet
  readonly localDisklet: Disklet
  sync: () => Promise<void>
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

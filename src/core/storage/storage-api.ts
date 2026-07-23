import { Disklet } from 'disklet'
import { bridgifyObject } from 'yaob'

import { EdgeWalletInfo } from '../../types/types'
import { asEdgeStorageKeys } from '../login/storage-keys'
import { ApiInput, RootProps } from '../root-pixie'
import { makeLocalDisklet, makeRepoPaths } from './repo'
import { syncStorageWallet } from './storage-actions'
import {
  getStorageWalletDisklet,
  getStorageWalletLocalDisklet
} from './storage-selectors'

export interface EdgeStorageWallet {
  readonly id: string
  readonly keys: object
  readonly type: string
  readonly disklet: Disklet
  readonly localDisklet: Disklet
  sync: () => Promise<void>
}

export function makeStorageWalletApi(
  ai: ApiInput,
  walletInfo: EdgeWalletInfo,
  /**
   * Throws when the owning account or wallet is gone, so a pending
   * `sync` rejects on logout or deletion instead of hanging forever.
   */
  checkAlive?: (props: RootProps) => void
): EdgeStorageWallet {
  const { id, type, keys } = walletInfo

  // The storage wallet may not be attached to Redux yet (a
  // cache-seeded login emits API objects before `addStorageWallet`
  // runs), so fall back to disklets built directly from the keys.
  // They point at the same files, with the same encryption, as the
  // attached versions:
  let fallbackDisklets: { disklet: Disklet; localDisklet: Disklet } | undefined
  function getFallbackDisklets(): { disklet: Disklet; localDisklet: Disklet } {
    if (fallbackDisklets == null) {
      const { io } = ai.props
      const localDisklet = makeLocalDisklet(io, id)
      bridgifyObject(localDisklet)
      fallbackDisklets = {
        disklet: makeRepoPaths(io, asEdgeStorageKeys(keys)).disklet,
        localDisklet
      }
    }
    return fallbackDisklets
  }

  return {
    // Broken-out key info:
    id,
    type,
    keys,

    // Folders:
    get disklet(): Disklet {
      if (ai.props.state.storageWallets[id] == null) {
        return getFallbackDisklets().disklet
      }
      return getStorageWalletDisklet(ai.props.state, id)
    },

    get localDisklet(): Disklet {
      if (ai.props.state.storageWallets[id] == null) {
        return getFallbackDisklets().localDisklet
      }
      return getStorageWalletLocalDisklet(ai.props.state, id)
    },

    async sync(): Promise<void> {
      // The storage wallet may not be attached yet on a cache-seeded
      // login; wait for `addStorageWallet` instead of throwing.
      // The liveness check only matters while the repo is missing,
      // so an unrelated later failure cannot break a working sync:
      await ai.waitFor(props => {
        if (props.state.storageWallets[id] != null) return true
        if (checkAlive != null) checkAlive(props)
      })
      await syncStorageWallet(ai, id)
    }
  }
}

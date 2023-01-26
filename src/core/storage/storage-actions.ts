import { navigateDisklet } from 'disklet'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { EdgeWalletInfo } from '../../types/types'
import { base58 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import { loadRepoStatus, makeRepoPaths, syncRepo } from './repo'
import { StorageWalletStatus } from './storage-reducer'

export async function addStorageWallet(
  ai: ApiInput,
  walletInfo: EdgeWalletInfo
): Promise<void> {
  const { dispatch, io, onError } = ai.props

  const dataKey = base64.parse(walletInfo.keys.dataKey)
  const syncKey = base64.parse(walletInfo.keys.syncKey)

  const paths = makeRepoPaths(io, syncKey, dataKey)
  const localDisklet = navigateDisklet(
    io.disklet,
    'local/' + base58.stringify(base64.parse(walletInfo.id))
  )
  bridgifyObject(localDisklet)

  const status: StorageWalletStatus = await loadRepoStatus(paths)
  dispatch({
    type: 'STORAGE_WALLET_ADDED',
    payload: {
      id: walletInfo.id,
      initialState: {
        localDisklet,
        paths,
        status,
        lastChanges: []
      }
    }
  })

  // If we have already done a sync, let this one run in the background:
  const syncPromise = syncStorageWallet(ai, walletInfo.id)
  if (status.lastSync > 0) {
    syncPromise.catch(error => {
      const { syncKey } = walletInfo.keys
      const { lastHash } = status
      ai.props.log.error(
        `Could not sync ${syncKey} with last hash ${String(lastHash)}: ${String(
          error
        )}`
      )
      onError(error)
    })
  } else await syncPromise
}

export function syncStorageWallet(
  ai: ApiInput,
  walletId: string
): Promise<string[]> {
  const { dispatch, syncClient, state } = ai.props
  const { paths, status } = state.storageWallets[walletId]

  return syncRepo(syncClient, paths, { ...status }).then(
    ({ changes, status }) => {
      dispatch({
        type: 'STORAGE_WALLET_SYNCED',
        payload: { id: walletId, changes: Object.keys(changes), status }
      })
      return Object.keys(changes)
    }
  )
}

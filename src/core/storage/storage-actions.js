// @flow

import { navigateDisklet } from 'disklet'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { type EdgeWalletInfo } from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { loadRepoStatus, makeRepoPaths, syncRepo } from './repo.js'

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

  const status = await loadRepoStatus(paths)
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
  if (status.lastSync) syncPromise.catch(e => onError(e))
  else await syncPromise
}

export function syncStorageWallet(
  ai: ApiInput,
  walletId: string
): Promise<string[]> {
  const { dispatch, io, log, state } = ai.props
  const { paths, status } = state.storageWallets[walletId]

  return syncRepo(io, log, paths, { ...status }).then(({ changes, status }) => {
    dispatch({
      type: 'STORAGE_WALLET_SYNCED',
      payload: { id: walletId, changes: Object.keys(changes), status }
    })
    return Object.keys(changes)
  })
}

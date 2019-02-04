// @flow

import { navigateDisklet } from 'disklet'
import { base64 } from 'rfc4648'
import { bridgifyObject } from 'yaob'

import { type EdgeWalletInfo } from '../../types/types.js'
import { base58 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { loadRepoStatus, makeRepoPaths, syncRepo } from './repo.js'

export function addStorageWallet (
  ai: ApiInput,
  walletInfo: EdgeWalletInfo
): Promise<mixed> {
  const { dispatch, io, onError } = ai.props

  const dataKey = base64.parse(walletInfo.keys.dataKey)
  const syncKey = base64.parse(walletInfo.keys.syncKey)

  const paths = makeRepoPaths(io, syncKey, dataKey)
  const localDisklet = navigateDisklet(
    io.disklet,
    'local/' + base58.stringify(base64.parse(walletInfo.id))
  )
  bridgifyObject(localDisklet)

  return loadRepoStatus(paths).then(status => {
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

    const syncPromise = syncStorageWallet(ai, walletInfo.id)
    if (status.lastSync) {
      // If we have already done a sync, let this one run in the background:
      syncPromise.catch(e => onError(e))
      return Promise.resolve({ status, changes: [] })
    }
    return syncPromise
  })
}

export function syncStorageWallet (
  ai: ApiInput,
  walletId: string
): Promise<Array<string>> {
  const { dispatch, io, state } = ai.props
  const { paths, status } = state.storageWallets[walletId]

  return syncRepo(io, paths, { ...status }).then(({ changes, status }) => {
    dispatch({
      type: 'STORAGE_WALLET_SYNCED',
      payload: { id: walletId, changes: Object.keys(changes), status }
    })
    return Object.keys(changes)
  })
}

// @flow

import type { EdgeWalletInfo } from '../../edge-core-index.js'
import { base58, base64 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { loadRepoStatus, makeRepoPaths, syncRepo } from './repo.js'

export function addStorageWallet (
  ai: ApiInput,
  walletInfo: EdgeWalletInfo
): Promise<mixed> {
  const { dispatch, io, onError } = ai.props

  const paths = makeRepoPaths(io, walletInfo)
  const localFolder = io.folder
    .folder('local')
    .folder(base58.stringify(base64.parse(walletInfo.id)))

  return loadRepoStatus(paths).then(status => {
    dispatch({
      type: 'STORAGE_WALLET_ADDED',
      payload: {
        id: walletInfo.id,
        initialState: { localFolder, paths, status, lastChanges: [] }
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

import { base58, base64 } from '../../util/encoding.js'
import { loadRepoStatus, makeRepoPaths, syncRepo } from '../storage/repo.js'
import { add, update } from './reducer.js'

export function addStorageWallet (keyInfo, onError, io) {
  return (dispatch, getState) => {
    const paths = makeRepoPaths(io, keyInfo)
    const localFolder = io.folder
      .folder('local')
      .folder(base58.stringify(base64.parse(keyInfo.id)))

    return loadRepoStatus(paths).then(status => {
      dispatch(add(keyInfo.id, { localFolder, paths, status }))
      const syncPromise = dispatch(syncStorageWallet(keyInfo.id, io))
      if (status.lastSync) {
        // If we have already done a sync, let this one run in the background:
        syncPromise.catch(e => onError(e))
        return Promise.resolve({ status, changes: [] })
      }
      return syncPromise
    })
  }
}

export function syncStorageWallet (keyId, io) {
  return (dispatch, getState) => {
    const state = getState()
    const { paths, status } = state.storageWallets[keyId]

    return syncRepo(io, paths, { ...status }).then(({ changes, status }) => {
      const action = {
        type: 'REPO_SYNCED',
        payload: { changes: Object.keys(changes), status }
      }
      dispatch(update(keyId, action))
      return Object.keys(changes)
    })
  }
}

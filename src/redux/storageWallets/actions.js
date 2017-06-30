import { makeRepoPaths, loadRepoStatus, syncRepo } from '../../storage/repo.js'
import { base58, base64 } from '../../util/encoding.js'
import { getIo } from '../selectors.js'
import { add, setStatus } from './reducer.js'

export function addStorageWallet (keyInfo) {
  return (dispatch, getState) => {
    const io = getIo(getState())

    const paths = makeRepoPaths(io, keyInfo)
    const localFolder = io.folder
      .folder('local')
      .folder(base58.stringify(base64.parse(keyInfo.id)))

    return loadRepoStatus(paths).then(status => {
      dispatch(add(keyInfo.id, { localFolder, paths, status }))
      return dispatch(syncStorageWallet(keyInfo.id))
    })
  }
}

export function syncStorageWallet (keyId) {
  return (dispatch, getState) => {
    const state = getState()
    const io = getIo(state)
    const { paths, status } = state.storageWallets[keyId]

    return syncRepo(io, paths, { ...status }).then(({ changes, status }) => {
      dispatch(setStatus(keyId, status))
      return Object.keys(changes).length !== 0
    })
  }
}

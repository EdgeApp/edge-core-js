import { makeRepoPaths, syncRepo } from '../storage/repo.js'
import { base58, base64 } from '../util/encoding.js'

function nop () {}

export class StorageState {
  constructor (io, keyInfo, paths, onDataChanged) {
    this.io = io
    this.keyInfo = keyInfo
    this.onDataChanged = onDataChanged
    this.paths = paths
    this.folder = paths.folder
    this.localFolder = io.folder
      .folder('local')
      .folder(base58.stringify(base64.parse(keyInfo.id)))
  }

  sync () {
    return syncRepo(this.io, this.paths).then(dirty => {
      if (dirty) this.onDataChanged()
      return dirty
    })
  }
}

export function makeStorageState (keyInfo, opts = {}) {
  const { io, onDataChanged = nop } = opts

  const paths = makeRepoPaths(io, keyInfo)
  const state = new StorageState(io, keyInfo, paths, onDataChanged)
  return state.sync().then(changed => state)
}

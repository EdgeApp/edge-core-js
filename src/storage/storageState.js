import { makeRepoFolder, syncRepo } from '../storage/repo.js'
import { base58, base64 } from '../util/encoding.js'

function nop () {}

export class StorageState {
  constructor (io, keyInfo, onDataChanged) {
    this.io = io
    this.keyInfo = keyInfo
    this.onDataChanged = onDataChanged

    this.folder = makeRepoFolder(io, keyInfo)
    this.localFolder = io.folder
      .folder('local')
      .folder(base58.stringify(base64.parse(keyInfo.id)))
  }

  sync () {
    return syncRepo(this.io, this.keyInfo).then(dirty => {
      if (dirty) this.onDataChanged()
      return dirty
    })
  }
}

export function makeStorageState (keyInfo, opts = {}) {
  const { io, onDataChanged = nop } = opts

  const state = new StorageState(io, keyInfo, onDataChanged)
  return state.sync().then(changed => state)
}

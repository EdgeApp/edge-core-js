import { hmacSha256 } from '../crypto/crypto.js'
import { makeRepoPaths, loadRepoStatus, syncRepo } from '../storage/repo.js'
import { base58, base64 } from '../util/encoding.js'
import { makeStore } from '../util/derive.js'

function nop () {}

export class StorageState {
  constructor (io, keyInfo, paths, status, onDataChanged) {
    this.io = io
    this.keyInfo = keyInfo
    this.onDataChanged = onDataChanged
    this.paths = paths
    this.folder = paths.folder
    this.localFolder = io.folder
      .folder('local')
      .folder(base58.stringify(base64.parse(keyInfo.id)))

    // Mutable state:
    this.status = status
    this.epoch = makeStore(0) // Incremented on every dirty sync.
  }

  sync () {
    return syncRepo(
      this.io,
      this.paths,
      this.status
    ).then(({ changes, status }) => {
      this.status = status
      const dirty = Object.keys(changes).length !== 0
      if (dirty) {
        this.epoch.set(this.epoch() + 1)
        this.onDataChanged()
      }
      return dirty
    })
  }

  /**
   * Creates a secure file name by hashing
   * the provided binary data with the repo's dataKey.
   */
  hashFilename (data) {
    const { paths: { dataKey } } = this
    return base58.stringify(hmacSha256(data, dataKey))
  }
}

export function makeStorageState (keyInfo, opts = {}) {
  const { io, onDataChanged = nop } = opts

  const paths = makeRepoPaths(io, keyInfo)
  return loadRepoStatus(paths).then(status => {
    const state = new StorageState(io, keyInfo, paths, status, onDataChanged)

    return state.sync().then(changed => state)
  })
}

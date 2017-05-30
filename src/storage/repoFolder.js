import { decrypt, encrypt } from '../crypto/crypto.js'
import { utf8 } from '../util/encoding.js'

/**
 * A file within an encrypted folder.
 */
class RepoFile {
  constructor (io, dataKey, file) {
    this.io = io
    this.dataKey = dataKey
    this.file = file
  }

  delete () {
    return this.file.delete()
  }

  getData () {
    return this.file
      .getText()
      .then(text => JSON.parse(text))
      .then(json => decrypt(json, this.dataKey))
  }

  getText () {
    return this.getData().then(data => utf8.stringify(data))
  }

  setData (data) {
    return this.file.setText(
      JSON.stringify(encrypt(this.io, data, this.dataKey))
    )
  }

  setText (text) {
    return this.setData(utf8.parse(text))
  }
}

/**
 * Wraps a folder with automatic encryption and decryption.
 */
export class RepoFolder {
  constructor (io, dataKey, folder) {
    this.io = io
    this.dataKey = dataKey
    this.inner = folder
  }

  delete () {
    return this.inner.delete()
  }

  file (name) {
    return new RepoFile(this.io, this.dataKey, this.inner.file(name))
  }

  folder (name) {
    return new RepoFolder(this.io, this.dataKey, this.inner.folder(name))
  }

  listFiles () {
    return this.inner.listFiles()
  }

  listFolders () {
    return this.inner.listFolders()
  }
}

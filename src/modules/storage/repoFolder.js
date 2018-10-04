// @flow

import {
  type DiskletFile,
  type DiskletFolder,
  type EdgeIo
} from '../../edge-core-index.js'
import { decrypt, encrypt } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding.js'

/**
 * A file within an encrypted folder.
 */
class RepoFile {
  io: EdgeIo
  dataKey: Uint8Array
  file: DiskletFile

  constructor (io: EdgeIo, dataKey: Uint8Array, file: DiskletFile) {
    this.io = io
    this.dataKey = dataKey
    this.file = file
  }

  delete () {
    return this.file.delete()
  }

  getData (): Promise<Uint8Array> {
    return this.file
      .getText()
      .then(text => JSON.parse(text))
      .then(json => decrypt(json, this.dataKey))
  }

  getText (): Promise<string> {
    return this.getData().then(data => utf8.stringify(data))
  }

  setData (data: Array<number> | Uint8Array): Promise<mixed> {
    const dataCast: any = data // Treating Array<number> like Uint8Array
    return this.file.setText(
      JSON.stringify(encrypt(this.io, dataCast, this.dataKey))
    )
  }

  setText (text: string): Promise<mixed> {
    return this.setData(utf8.parse(text))
  }
}

/**
 * Wraps a folder with automatic encryption and decryption.
 */
export class RepoFolder {
  io: EdgeIo
  dataKey: Uint8Array
  inner: DiskletFolder

  constructor (io: EdgeIo, dataKey: Uint8Array, folder: DiskletFolder) {
    this.io = io
    this.dataKey = dataKey
    this.inner = folder
  }

  delete () {
    return this.inner.delete()
  }

  file (name: string): DiskletFile {
    return new RepoFile(this.io, this.dataKey, this.inner.file(name))
  }

  folder (name: string): DiskletFolder {
    return new RepoFolder(this.io, this.dataKey, this.inner.folder(name))
  }

  listFiles () {
    return this.inner.listFiles()
  }

  listFolders () {
    return this.inner.listFolders()
  }
}

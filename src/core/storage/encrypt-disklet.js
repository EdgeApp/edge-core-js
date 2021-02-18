// @flow

import { type ArrayLike, type Disklet, type DiskletListing } from 'disklet'
import { bridgifyObject } from 'yaob'

import { type EdgeIo } from '../../types/types.js'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto.js'
import { utf8 } from '../../util/encoding.js'

export function encryptDisklet(
  io: EdgeIo,
  dataKey: Uint8Array,
  disklet: Disklet
): Disklet {
  const out = {
    delete(path: string): Promise<mixed> {
      return disklet.delete(path)
    },

    getData(path: string): Promise<Uint8Array> {
      return disklet
        .getText(path)
        .then(text => JSON.parse(text))
        .then(json => decrypt(json, dataKey))
    },

    getText(path: string): Promise<string> {
      return disklet
        .getText(path)
        .then(text => JSON.parse(text))
        .then(json => decryptText(json, dataKey))
    },

    list(path?: string): Promise<DiskletListing> {
      return disklet.list(path)
    },

    setData(path: string, data: ArrayLike<number>): Promise<mixed> {
      const dataCast: any = data // Work around `Uint8Array.from` flow bug
      return disklet.setText(
        path,
        JSON.stringify(encrypt(io, Uint8Array.from(dataCast), dataKey))
      )
    },

    setText(path: string, text: string): Promise<mixed> {
      return this.setData(path, utf8.parse(text))
    }
  }
  bridgifyObject(out)
  return out
}

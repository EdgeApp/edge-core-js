import { Disklet, DiskletListing } from 'disklet'
import { bridgifyObject } from 'yaob'

import { asEdgeBox } from '../../types/server-cleaners'
import { EdgeIo } from '../../types/types'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto'
import { utf8 } from '../../util/encoding'

export function encryptDisklet(
  io: EdgeIo,
  dataKey: Uint8Array,
  disklet: Disklet
): Disklet {
  const out = {
    delete(path: string): Promise<unknown> {
      return disklet.delete(path)
    },

    async getData(path: string): Promise<Uint8Array> {
      const text = await disklet.getText(path)
      const box = asEdgeBox(JSON.parse(text))
      return decrypt(box, dataKey)
    },

    async getText(path: string): Promise<string> {
      const text = await disklet.getText(path)
      const box = asEdgeBox(JSON.parse(text))
      return decryptText(box, dataKey)
    },

    list(path?: string): Promise<DiskletListing> {
      return disklet.list(path)
    },

    setData(path: string, data: ArrayLike<number>): Promise<unknown> {
      const dataCast: any = data // Work around `Uint8Array.from` flow bug
      return disklet.setText(
        path,
        JSON.stringify(encrypt(io, Uint8Array.from(dataCast), dataKey))
      )
    },

    setText(path: string, text: string): Promise<unknown> {
      return this.setData(path, utf8.parse(text))
    }
  }
  bridgifyObject(out)
  return out
}

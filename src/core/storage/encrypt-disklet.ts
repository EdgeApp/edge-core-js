import { Disklet, DiskletListing } from 'disklet'
import { bridgifyObject } from 'yaob'

import { asEdgeBox, wasEdgeBox } from '../../types/server-cleaners'
import { EdgeIo } from '../../types/types'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto'
import { utf8 } from '../../util/encoding'

/**
 * Creates an encrypted disklet that wraps another disklet.
 * Optionally accepts a deletedDisklet for sync-aware deletions.
 * When deletedDisklet is provided, delete operations will mark files
 * for deletion by writing an empty file to the deleted/ directory,
 * which will be processed during the next sync.
 */
export function encryptDisklet(
  io: EdgeIo,
  dataKey: Uint8Array,
  disklet: Disklet,
  /** Provide when this disklet is synchronized with edge-sync-client's syncRepo */
  deletedDisklet?: Disklet
): Disklet {
  const out = {
    async delete(path: string): Promise<unknown> {
      // If we have a deletedDisklet, mark the file for deletion
      // by writing an empty file to the deleted/ directory.
      // The sync process will handle the actual deletion.
      if (deletedDisklet != null) {
        await deletedDisklet.setText(path, '')
      }
      // Also delete locally for immediate effect:
      return await disklet.delete(path)
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
      return disklet.setText(
        path,
        JSON.stringify(wasEdgeBox(encrypt(io, Uint8Array.from(data), dataKey)))
      )
    },

    setText(path: string, text: string): Promise<unknown> {
      return this.setData(path, utf8.parse(text))
    }
  }
  bridgifyObject(out)
  return out
}

import { Disklet, DiskletListing } from 'disklet'
import { bridgifyObject } from 'yaob'

/**
 * A wallet's local storage, as an engine sees it once plugins keep their
 * state in the database.
 *
 * Reads stay, because a plugin imports its old files once. Deletes stay,
 * because a resync has to make forgotten history unreachable, and removing
 * the file it would otherwise be re-imported from is how. Writes are gone:
 * no plugin stores JSON here any more, whatever it intends.
 */
export function readOnlyDisklet(disklet: Disklet): Disklet {
  function refuse(): Promise<unknown> {
    return Promise.reject(
      new Error("The wallet's local storage is read-only; use the database")
    )
  }

  const out: Disklet = {
    delete(path: string): Promise<unknown> {
      return disklet.delete(path)
    },

    getData(path: string): Promise<Uint8Array> {
      return disklet.getData(path)
    },

    getText(path: string): Promise<string> {
      return disklet.getText(path)
    },

    list(path?: string): Promise<DiskletListing> {
      return disklet.list(path)
    },

    setData: refuse,
    setText: refuse
  }
  bridgifyObject(out)
  return out
}

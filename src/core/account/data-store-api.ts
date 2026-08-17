import { asObject, asString } from 'cleaners'
import { Disklet, justFiles, justFolders } from 'disklet'
import { bridgifyObject } from 'yaob'

import { EdgeDataStore } from '../../types/types'
import { makeJsonFile } from '../../util/file-helpers'
import { ApiInput } from '../root-pixie'
import {
  getStorageWalletDisklet,
  hashStorageWalletFilename
} from '../storage/storage-selectors'
import { waitForAccountRepo } from './account-files'

/**
 * Each data store folder has a "Name.json" file with this format.
 */
const storeIdFile = makeJsonFile(
  asObject({
    name: asString
  })
)

/**
 * The items saved in a data store have this format.
 */
const storeItemFile = makeJsonFile(
  asObject({
    key: asString,
    data: asString
  })
)

export function makeDataStoreApi(
  ai: ApiInput,
  accountId: string
): EdgeDataStore {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]

  // A cache-seeded login emits the account API object before the
  // account's storage wallet exists, so resolve the disklet on
  // demand instead of at construction time:
  async function getDisklet(): Promise<Disklet> {
    await waitForAccountRepo(ai, accountId)
    return getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)
  }

  // Path manipulation (only call once the storage wallet exists):
  const hashName = (data: string): string =>
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, data)
  const getStorePath = (storeId: string): string =>
    `Plugins/${hashName(storeId)}`
  const getItemPath = (storeId: string, itemId: string): string =>
    `${getStorePath(storeId)}/${hashName(itemId)}.json`

  const out: EdgeDataStore = {
    async deleteItem(storeId: string, itemId: string): Promise<void> {
      const disklet = await getDisklet()
      await disklet.delete(getItemPath(storeId, itemId))
    },

    async deleteStore(storeId: string): Promise<void> {
      const disklet = await getDisklet()
      await disklet.delete(getStorePath(storeId))
    },

    async listItemIds(storeId: string): Promise<string[]> {
      const disklet = await getDisklet()
      const itemIds: string[] = []
      const paths = justFiles(await disklet.list(getStorePath(storeId)))
      await Promise.all(
        paths.map(async path => {
          const clean = await storeItemFile.load(disklet, path)
          if (clean != null) itemIds.push(clean.key)
        })
      )
      return itemIds
    },

    async listStoreIds(): Promise<string[]> {
      const disklet = await getDisklet()
      const storeIds: string[] = []
      const paths = justFolders(await disklet.list('Plugins'))
      await Promise.all(
        paths.map(async path => {
          const clean = await storeIdFile.load(disklet, `${path}/Name.json`)
          if (clean != null) storeIds.push(clean.name)
        })
      )
      return storeIds
    },

    async getItem(storeId: string, itemId: string): Promise<string> {
      const disklet = await getDisklet()
      const clean = await storeItemFile.load(
        disklet,
        getItemPath(storeId, itemId)
      )
      if (clean == null) throw new Error(`No item named "${itemId}"`)
      return clean.data
    },

    async setItem(
      storeId: string,
      itemId: string,
      value: string
    ): Promise<void> {
      const disklet = await getDisklet()

      // Set up the plugin folder, if needed:
      const namePath = `${getStorePath(storeId)}/Name.json`
      const clean = await storeIdFile.load(disklet, namePath)
      if (clean == null) {
        await storeIdFile.save(disklet, namePath, { name: storeId })
      } else if (clean.name !== storeId) {
        throw new Error(`Warning: folder name doesn't match for ${storeId}`)
      }

      // Set up the actual item:
      await storeItemFile.save(disklet, getItemPath(storeId, itemId), {
        key: itemId,
        data: value
      })
    }
  }
  bridgifyObject(out)

  return out
}

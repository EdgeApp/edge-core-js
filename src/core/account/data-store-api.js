// @flow

import {
  type DiskletFile,
  type DiskletFolder,
  mapFiles,
  mapFolders
} from 'disklet'
import { bridgifyObject } from 'yaob'

import { type EdgeDataStore, type EdgeWalletInfo } from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'

function getPluginsFolder(
  ai: ApiInput,
  accountWalletInfo: EdgeWalletInfo
): DiskletFolder {
  const folder = getStorageWalletFolder(ai.props.state, accountWalletInfo.id)
  return folder.folder('Plugins')
}

function getPluginFolder(
  ai: ApiInput,
  accountWalletInfo: EdgeWalletInfo,
  storeId: string
): DiskletFolder {
  const folder = getPluginsFolder(ai, accountWalletInfo)
  return folder.folder(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, storeId)
  )
}

function getPluginFile(
  ai: ApiInput,
  accountWalletInfo: EdgeWalletInfo,
  storeId: string,
  itemId: string
): DiskletFile {
  const folder = getPluginFolder(ai, accountWalletInfo, storeId)
  return folder.file(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, itemId) +
      '.json'
  )
}

export function makeDataStoreApi(
  ai: ApiInput,
  accountId: string
): EdgeDataStore {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]

  const out: EdgeDataStore = {
    async deleteItem(storeId: string, itemId: string): Promise<void> {
      const file = getPluginFile(ai, accountWalletInfo, storeId, itemId)
      await file.delete()
    },

    async deleteStore(storeId: string): Promise<void> {
      const folder = getPluginFolder(ai, accountWalletInfo, storeId)
      await folder.delete()
    },

    async listItemIds(storeId: string): Promise<string[]> {
      const folder = getPluginFolder(ai, accountWalletInfo, storeId)

      const itemIds = await mapFiles(folder, file =>
        file
          .getText()
          .then(text => JSON.parse(text).key)
          .catch(e => undefined)
      )
      return itemIds.filter(itemId => typeof itemId === 'string')
    },

    async listStoreIds(): Promise<string[]> {
      const folder = getPluginsFolder(ai, accountWalletInfo)

      const storeIds = await mapFolders(folder, folder =>
        folder
          .file('Name.json')
          .getText()
          .then(text => JSON.parse(text).name)
          .catch(e => undefined)
      )
      return storeIds.filter(storeId => typeof storeId === 'string')
    },

    async getItem(storeId: string, itemId: string): Promise<string> {
      const file = getPluginFile(ai, accountWalletInfo, storeId, itemId)
      const text = await file.getText()
      return JSON.parse(text).data
    },

    async setItem(
      storeId: string,
      itemId: string,
      value: string
    ): Promise<void> {
      // Set up the plugin folder, if needed:
      const folder = getPluginFolder(ai, accountWalletInfo, storeId)
      const storeIdFile = folder.file('Name.json')
      try {
        const text = await storeIdFile.getText()
        if (JSON.parse(text).name !== storeId) {
          throw new Error(`Warning: folder name doesn't match for ${storeId}`)
        }
      } catch (e) {
        await storeIdFile.setText(JSON.stringify({ name: storeId }))
      }

      // Set up the actual item:
      const file = getPluginFile(ai, accountWalletInfo, storeId, itemId)
      await file.setText(JSON.stringify({ key: itemId, data: value }))
    }
  }
  bridgifyObject(out)

  return out
}

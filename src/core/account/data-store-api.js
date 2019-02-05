// @flow

import { mapFiles, mapFolders } from 'disklet'
import { bridgifyObject } from 'yaob'

import { type EdgeDataStore, type EdgePluginData } from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'

function getPluginsFolder (ai, accountWalletInfo) {
  const folder = getStorageWalletFolder(ai.props.state, accountWalletInfo.id)
  return folder.folder('Plugins')
}

function getPluginFolder (ai, accountWalletInfo, storeId) {
  const folder = getPluginsFolder(ai, accountWalletInfo)
  return folder.folder(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, storeId)
  )
}

function getPluginFile (ai, accountWalletInfo, storeId, itemId) {
  const folder = getPluginFolder(ai, accountWalletInfo, storeId)
  return folder.file(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, itemId) +
      '.json'
  )
}

export function makeDataStoreApi (
  ai: ApiInput,
  accountId: string
): EdgeDataStore {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]

  const out: EdgeDataStore = {
    async deleteItem (storeId: string, itemId: string): Promise<mixed> {
      const file = getPluginFile(ai, accountWalletInfo, storeId, itemId)
      await file.delete()
    },

    async deleteStore (storeId: string): Promise<mixed> {
      const folder = getPluginFolder(ai, accountWalletInfo, storeId)
      await folder.delete()
    },

    async listItemIds (storeId: string): Promise<Array<string>> {
      const folder = getPluginFolder(ai, accountWalletInfo, storeId)

      const itemIds = await mapFiles(folder, file =>
        file
          .getText()
          .then(text => JSON.parse(text).key)
          .catch(e => void 0)
      )
      return itemIds.filter(itemId => typeof itemId === 'string')
    },

    async listStoreIds (): Promise<Array<string>> {
      const folder = getPluginsFolder(ai, accountWalletInfo)

      const storeIds = await mapFolders(folder, folder =>
        folder
          .file('Name.json')
          .getText()
          .then(text => JSON.parse(text).name)
          .catch(e => void 0)
      )
      return storeIds.filter(storeId => typeof storeId === 'string')
    },

    async getItem (storeId: string, itemId: string): Promise<string> {
      const file = getPluginFile(ai, accountWalletInfo, storeId, itemId)
      const text = await file.getText()
      return JSON.parse(text).data
    },

    async setItem (
      storeId: string,
      itemId: string,
      value: string
    ): Promise<mixed> {
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

export function makePluginDataApi (dataStore: EdgeDataStore): EdgePluginData {
  const out: EdgePluginData = {
    deleteItem (pluginId: string, itemId: string): Promise<mixed> {
      return dataStore.deleteItem(pluginId, itemId)
    },

    deletePlugin (pluginId: string): Promise<mixed> {
      return dataStore.deleteStore(pluginId)
    },

    listItemIds (pluginId: string): Promise<Array<string>> {
      return dataStore.listItemIds(pluginId)
    },

    listPluginIds (): Promise<Array<string>> {
      return dataStore.listStoreIds()
    },

    getItem (pluginId: string, itemId: string): Promise<string> {
      return dataStore.getItem(pluginId, itemId)
    },

    setItem (pluginId: string, itemId: string, value: string): Promise<mixed> {
      return dataStore.setItem(pluginId, itemId, value)
    }
  }
  bridgifyObject(out)

  return out
}

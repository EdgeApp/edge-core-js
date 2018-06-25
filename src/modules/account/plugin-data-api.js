// @flow

import { mapFiles, mapFolders } from 'disklet'

import type { EdgePluginData } from '../../edge-core-index.js'
import type { ApiInput } from '../root.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'
import { AccountState } from './account-state.js'

function getPluginsFolder (ai, accountWalletInfo) {
  const folder = getStorageWalletFolder(ai.props.state, accountWalletInfo.id)
  return folder.folder('Plugins')
}

function getPluginFolder (ai, accountWalletInfo, pluginId) {
  const folder = getPluginsFolder(ai, accountWalletInfo)
  return folder.folder(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, pluginId)
  )
}

function getPluginFile (ai, accountWalletInfo, pluginId, itemId) {
  const folder = getPluginFolder(ai, accountWalletInfo, pluginId)
  return folder.file(
    hashStorageWalletFilename(ai.props.state, accountWalletInfo.id, itemId) +
      '.json'
  )
}

export function makePluginDataApi (
  ai: ApiInput,
  accountState: AccountState
): EdgePluginData {
  const { accountWalletInfo } = accountState

  const out: EdgePluginData = {
    async deleteItem (pluginId: string, itemId: string): Promise<mixed> {
      const file = getPluginFile(ai, accountWalletInfo, pluginId, itemId)
      await file.delete()
    },

    async deletePlugin (pluginId: string): Promise<mixed> {
      const folder = getPluginFolder(ai, accountWalletInfo, pluginId)
      await folder.delete()
    },

    async listItemIds (pluginId: string): Promise<Array<string>> {
      const folder = getPluginFolder(ai, accountWalletInfo, pluginId)

      const itemIds = await mapFiles(folder, file =>
        file
          .getText()
          .then(text => JSON.parse(text).key)
          .catch(e => void 0)
      )
      return itemIds.filter(itemId => typeof itemId === 'string')
    },

    async listPluginIds (): Promise<Array<string>> {
      const folder = getPluginsFolder(ai, accountWalletInfo)

      const pluginIds = await mapFolders(folder, folder =>
        folder
          .file('Name.json')
          .getText()
          .then(text => JSON.parse(text).name)
          .catch(e => void 0)
      )
      return pluginIds.filter(pluginId => typeof pluginId === 'string')
    },

    async getItem (pluginId: string, itemId: string): Promise<string> {
      const file = getPluginFile(ai, accountWalletInfo, pluginId, itemId)
      const text = await file.getText()
      return JSON.parse(text).data
    },

    async setItem (
      pluginId: string,
      itemId: string,
      value: string
    ): Promise<mixed> {
      // Set up the plugin folder, if needed:
      const folder = getPluginFolder(ai, accountWalletInfo, pluginId)
      const pluginIdFile = folder.file('Name.json')
      try {
        const text = await pluginIdFile.getText()
        if (JSON.parse(text).name !== pluginId) {
          throw new Error(`Warning: folder name doesn't match for ${pluginId}`)
        }
      } catch (e) {
        await pluginIdFile.setText(JSON.stringify({ name: pluginId }))
      }

      // Set up the actual item:
      const file = getPluginFile(ai, accountWalletInfo, pluginId, itemId)
      await file.setText(JSON.stringify({ key: itemId, data: value }))
    }
  }

  return out
}

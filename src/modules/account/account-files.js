// @flow

import { mapFiles } from 'disklet'

import {
  type DiskletFile,
  type EdgeCurrencyPlugin,
  type EdgeWalletInfo,
  type EdgeWalletStates
} from '../../index.js'
import { base16, base64 } from '../../util/encoding.js'
import { makeKeyInfo } from '../login/keys.js'
import { type ApiInput } from '../root.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'

const CURRENCY_SETTINGS_FILE = 'CurrencySettings.json'

/**
 * Returns true if `Object.assign(a, b)` would alter `a`.
 */
function different (a, b) {
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) {
      return true
    }
  }
  return false
}

function getJson (file: DiskletFile, fallback: Object = {}) {
  return file
    .getText()
    .then(text => JSON.parse(text))
    .catch(e => fallback)
}

function getJsonFiles (folder) {
  return mapFiles(folder, (file, name) =>
    file
      .getText()
      .then(text => ({ file, name, json: JSON.parse(text) }))
      .catch(e => void 0)
  ).then(files => files.filter(file => file != null))
}

function findPlugin (
  plugins: Array<EdgeCurrencyPlugin>,
  pluginName: string
): EdgeCurrencyPlugin | void {
  for (const plugin of plugins) {
    if (plugin.pluginName === pluginName) return plugin
  }
}

/**
 * Loads the legacy wallet list from the account folder.
 */
function loadWalletList (
  folder
): Promise<{
  walletInfos: Array<EdgeWalletInfo>,
  walletStates: EdgeWalletStates
}> {
  return getJsonFiles(folder.folder('Wallets')).then(files => {
    const walletInfos = []
    const walletStates = {}

    files.forEach(file => {
      const { SortIndex, Archived, BitcoinSeed, MK, SyncKey } = file.json

      const dataKey = base16.parse(MK)
      const bitcoinKey = base16.parse(BitcoinSeed)
      const syncKey = base16.parse(SyncKey)
      const keys = {
        bitcoinKey: base64.stringify(bitcoinKey),
        dataKey: base64.stringify(dataKey),
        format: 'bip32',
        syncKey: base64.stringify(syncKey)
      }

      const keyInfo = makeKeyInfo('wallet:bitcoin', keys, dataKey)
      walletInfos.push(keyInfo)
      walletStates[keyInfo.id] = {
        sortIndex: SortIndex,
        archived: Archived,
        deleted: false
      }
    })

    return { walletInfos, walletStates }
  })
}

/**
 * Loads the modern key state list from the account folder.
 */
function loadWalletStates (folder): Promise<EdgeWalletStates> {
  return getJsonFiles(folder.folder('Keys')).then(files => {
    const keyStates = {}

    files.forEach(file => {
      const { id, archived, deleted, sortIndex } = file.json
      keyStates[id] = { archived, deleted, sortIndex }
    })

    return keyStates
  })
}

/**
 * Loads the keyStates and legacy wallet list,
 * diffs them with the current keyStates and legacy wallet list,
 * and returns true if there are any changes.
 */
export async function loadAllWalletStates (
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]

  const folder = getStorageWalletFolder(ai.props.state, accountWalletInfo.id)

  return Promise.all([loadWalletList(folder), loadWalletStates(folder)]).then(
    values => {
      const [
        { walletInfos, walletStates: legacyWalletStates },
        newKeyStates
      ] = values
      const walletStates = { ...legacyWalletStates, ...newKeyStates }

      ai.props.dispatch({
        type: 'ACCOUNT_KEYS_LOADED',
        payload: {
          accountId,
          legacyWalletInfos: walletInfos,
          walletStates
        }
      })
    }
  )
}

/**
 * Changes the wallet states within an account.
 */
export async function changeWalletStates (
  ai: ApiInput,
  accountId: string,
  newStates: EdgeWalletStates
) {
  const { accountWalletInfo, walletStates } = ai.props.state.accounts[accountId]

  // Find the changes between the new states and the old states:
  const toWrite = {}
  for (const id of Object.keys(newStates)) {
    if (walletStates[id] == null) {
      // We don't have this id, so everything is new:
      toWrite[id] = newStates[id]
    } else if (different(walletStates[id], newStates[id])) {
      // We already have this id, so only update if it has changed:
      toWrite[id] = { ...walletStates[id], ...newStates[id] }
    }
  }

  // If there are no changes, do nothing:
  const walletIds = Object.keys(toWrite)
  if (!walletIds.length) return

  const keyFolder = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).folder('Keys')
  await Promise.all(
    walletIds.map(walletId => {
      const { archived, deleted, sortIndex } = toWrite[walletId]
      const walletIdHash = hashStorageWalletFilename(
        ai.props.state,
        accountWalletInfo.id,
        walletId
      )
      return keyFolder
        .file(`${walletIdHash}.json`)
        .setText(JSON.stringify({ archived, deleted, sortIndex, id: walletId }))
    })
  )

  ai.props.dispatch({
    type: 'ACCOUNT_CHANGED_WALLET_STATES',
    payload: { accountId, walletStates: { ...walletStates, ...toWrite } }
  })
}

/**
 * Changes a currency plugin's settings within an account.
 */
export async function changePluginSettings (
  ai: ApiInput,
  accountId: string,
  plugin: EdgeCurrencyPlugin,
  settings: Object
) {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(CURRENCY_SETTINGS_FILE)

  // Actually change the settings on the plugin:
  if (plugin.changeSettings) {
    await plugin.changeSettings(settings)
  }

  // Write the new state to disk:
  const json = await getJson(file)
  json.pluginSettings = { ...ai.props.state.currency.settings }
  json.pluginSettings[plugin.pluginName] = settings
  await file.setText(JSON.stringify(json))

  // Update Redux:
  ai.props.dispatch({
    type: 'CHANGED_CURRENCY_PLUGIN_SETTING',
    payload: {
      pluginName: plugin.pluginName,
      settings
    }
  })
}

/**
 * Loads the settings for all the currency plugins within an account.
 */
export async function reloadPluginSettings (ai: ApiInput, accountId: string) {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(CURRENCY_SETTINGS_FILE)

  const json = await getJson(file)

  const goodSettings = {}
  const plugins = ai.props.output.currency.plugins
  if (json.pluginSettings != null && typeof json.pluginSettings === 'object') {
    const allSettings = json.pluginSettings
    for (const pluginName in allSettings) {
      const setting = allSettings[pluginName]
      const plugin = findPlugin(plugins, pluginName)

      if (plugin == null || plugin.changeSettings == null) {
        // If there is no plugin, we just assume the settings are good:
        goodSettings[pluginName] = setting
      } else {
        // Try applying the settings:
        try {
          await plugin.changeSettings(setting)
          goodSettings[pluginName] = setting
        } catch (e) {}
      }
    }
  }

  // Add the final list to Redux:
  ai.props.dispatch({
    type: 'NEW_CURRENCY_PLUGIN_SETTINGS',
    payload: goodSettings
  })
}

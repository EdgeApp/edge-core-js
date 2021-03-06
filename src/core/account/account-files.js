// @flow

import {
  type Cleaner,
  asBoolean,
  asCodec,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import { type DiskletFile, type DiskletFolder, mapFiles } from 'disklet'
import { base16, base64 } from 'rfc4648'

import {
  type EdgePluginMap,
  type EdgeWalletInfo,
  type EdgeWalletStates,
  type JsonObject
} from '../../types/types.js'
import { makeKeyInfo } from '../login/keys.js'
import { type ApiInput } from '../root-pixie.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'
import { type SwapSettings } from './account-reducer.js'

const PLUGIN_SETTINGS_FILE = 'PluginSettings.json'

type PluginSettingsFile = {
  userSettings?: EdgePluginMap<JsonObject>,
  swapSettings?: EdgePluginMap<SwapSettings>
}

type LoadedWalletList = {
  walletInfos: EdgeWalletInfo[],
  walletStates: EdgeWalletStates
}

const asBase16: Cleaner<Uint8Array> = asCodec(
  raw => base16.parse(asString(raw)),
  clean => base16.stringify(clean)
)

const asLegacyWalletFile = asObject({
  SortIndex: asOptional(asNumber, 0),
  Archived: asOptional(asBoolean, false),
  BitcoinSeed: asBase16,
  MK: asBase16,
  SyncKey: asBase16
}).withRest

/**
 * Returns true if `Object.assign(a, b)` would alter `a`.
 */
function different(a: any, b: any): boolean {
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) {
      return true
    }
  }
  return false
}

/**
 * Returns `value` if it is an object,
 * otherwise returns an empty fallback object.
 */
function getObject(value: any): any {
  if (value == null && typeof value !== 'object') return {}
  return value
}

function getJson(file: DiskletFile, fallback: any = {}): Promise<any> {
  return file
    .getText()
    .then(text => JSON.parse(text))
    .catch(e => fallback)
}

function getJsonFiles(folder: DiskletFolder): Promise<any[]> {
  return mapFiles(folder, (file, name) =>
    file
      .getText()
      .then(text => ({ file, name, json: JSON.parse(text) }))
      .catch(e => undefined)
  ).then(files => files.filter(file => file != null))
}

/**
 * Loads the legacy wallet list from the account folder.
 */
async function loadWalletList(
  folder: DiskletFolder
): Promise<LoadedWalletList> {
  const files = await getJsonFiles(folder.folder('Wallets'))

  const walletInfos: EdgeWalletInfo[] = []
  const walletStates = {}
  for (const file of files) {
    const clean = asMaybe(asLegacyWalletFile)(file.json)
    if (clean == null) continue

    const keys = {
      bitcoinKey: base64.stringify(clean.BitcoinSeed),
      dataKey: base64.stringify(clean.MK),
      format: 'bip32',
      syncKey: base64.stringify(clean.SyncKey)
    }

    const keyInfo = makeKeyInfo('wallet:bitcoin', keys, clean.MK)
    walletInfos.push(keyInfo)
    walletStates[keyInfo.id] = {
      sortIndex: clean.SortIndex,
      archived: clean.Archived,
      deleted: false,
      hidden: false
    }
  }

  return { walletInfos, walletStates }
}

/**
 * Loads the modern key state list from the account folder.
 */
function loadWalletStates(folder: DiskletFolder): Promise<EdgeWalletStates> {
  return getJsonFiles(folder.folder('Keys')).then(files => {
    const keyStates = {}

    files.forEach(file => {
      const { id, archived, deleted, hidden, sortIndex } = file.json
      keyStates[id] = { archived, deleted, hidden, sortIndex }
    })

    return keyStates
  })
}

/**
 * Loads the keyStates and legacy wallet list,
 * diffs them with the current keyStates and legacy wallet list,
 * and returns true if there are any changes.
 */
export async function loadAllWalletStates(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const selfState = ai.props.state.accounts[accountId]
  const { accountWalletInfo, accountWalletInfos } = selfState

  const lists: Promise<LoadedWalletList[]> = Promise.all(
    accountWalletInfos.map(info =>
      loadWalletList(getStorageWalletFolder(ai.props.state, info.id))
    )
  )

  // Read files from all repos:
  const [newStates, legacyLists] = await Promise.all([
    loadWalletStates(
      getStorageWalletFolder(ai.props.state, accountWalletInfo.id)
    ),
    lists
  ])

  // Merge all that information together:
  const legacyWalletInfos: EdgeWalletInfo[] = [].concat(
    ...legacyLists.map(files => files.walletInfos)
  )
  const legacyWalletStates: EdgeWalletStates[] = legacyLists.map(
    files => files.walletStates
  )
  const walletStates = Object.assign({}, ...legacyWalletStates, newStates)

  ai.props.dispatch({
    type: 'ACCOUNT_KEYS_LOADED',
    payload: {
      accountId,
      legacyWalletInfos,
      walletStates
    }
  })
}

/**
 * Changes the wallet states within an account.
 */
export async function changeWalletStates(
  ai: ApiInput,
  accountId: string,
  newStates: EdgeWalletStates
): Promise<void> {
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
      const { archived, deleted, hidden, sortIndex } = toWrite[walletId]
      const walletIdHash = hashStorageWalletFilename(
        ai.props.state,
        accountWalletInfo.id,
        walletId
      )
      return keyFolder
        .file(`${walletIdHash}.json`)
        .setText(
          JSON.stringify({ archived, deleted, hidden, sortIndex, id: walletId })
        )
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
export async function changePluginUserSettings(
  ai: ApiInput,
  accountId: string,
  pluginId: string,
  userSettings: JsonObject
): Promise<void> {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  // Write the new state to disk:
  const json: PluginSettingsFile = await getJson(file)
  json.userSettings = { ...ai.props.state.accounts[accountId].userSettings }
  json.userSettings[pluginId] = userSettings
  await file.setText(JSON.stringify(json))

  // Update Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_PLUGIN_SETTINGS_CHANGED',
    payload: {
      accountId,
      pluginId,
      userSettings: { ...userSettings }
    }
  })
}

/**
 * Enables or disables swap plugins.
 */
export async function changeSwapSettings(
  ai: ApiInput,
  accountId: string,
  pluginId: string,
  swapSettings: SwapSettings
): Promise<void> {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  // Write the new state to disk:
  const json: PluginSettingsFile = await getJson(file)
  json.swapSettings = { ...ai.props.state.accounts[accountId].swapSettings }
  json.swapSettings[pluginId] = swapSettings
  await file.setText(JSON.stringify(json))

  // Update Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_SWAP_SETTINGS_CHANGED',
    payload: { accountId, pluginId, swapSettings }
  })
}

/**
 * Loads the settings for all the currency plugins within an account.
 */
export async function reloadPluginSettings(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { accountWalletInfo } = ai.props.state.accounts[accountId]
  const file = getStorageWalletFolder(
    ai.props.state,
    accountWalletInfo.id
  ).file(PLUGIN_SETTINGS_FILE)

  const json: PluginSettingsFile = await getJson(file)

  const userSettings = getObject(json.userSettings)
  const swapSettings = getObject(json.swapSettings)

  // Add the final list to Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_PLUGIN_SETTINGS_LOADED',
    payload: { accountId, userSettings, swapSettings }
  })
}

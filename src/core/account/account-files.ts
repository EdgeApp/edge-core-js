import { Disklet, justFiles } from 'disklet'
import { base64 } from 'rfc4648'

import { EdgeWalletInfo, EdgeWalletStates, JsonObject } from '../../types/types'
import { makeJsonFile } from '../../util/file-helpers'
import { makeKeyInfo } from '../login/keys'
import { ApiInput } from '../root-pixie'
import {
  getStorageWalletDisklet,
  hashStorageWalletFilename
} from '../storage/storage-selectors'
import {
  asLegacyWalletFile,
  asPluginSettingsFile,
  asWalletStateFile
} from './account-cleaners'
import { SwapSettings } from './account-types'

const legacyWalletFile = makeJsonFile(asLegacyWalletFile)
const walletStateFile = makeJsonFile(asWalletStateFile)
const pluginSettingsFile = makeJsonFile(asPluginSettingsFile)

const emptySettings = asPluginSettingsFile({})

const PLUGIN_SETTINGS_FILE = 'PluginSettings.json'

interface LoadedWalletList {
  walletInfos: EdgeWalletInfo[]
  walletStates: EdgeWalletStates
}

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
 * Loads the legacy wallet list from the account folder.
 */
async function loadWalletList(disklet: Disklet): Promise<LoadedWalletList> {
  const walletInfos: EdgeWalletInfo[] = []
  const walletStates: EdgeWalletStates = {}
  const paths = justFiles(await disklet.list('Wallets'))
  await Promise.all(
    paths.map(async path => {
      const clean = await legacyWalletFile.load(disklet, path)
      if (clean == null) return

      const keys = {
        bitcoinKey: base64.stringify(clean.BitcoinSeed),
        dataKey: base64.stringify(clean.MK),
        format: 'bip32',
        syncKey: base64.stringify(clean.SyncKey)
      }

      const keyInfo = makeKeyInfo('wallet:bitcoin', keys, clean.MK)
      walletInfos.push(keyInfo)
      walletStates[keyInfo.id] = {
        archived: clean.Archived,
        deleted: false,
        hidden: false,
        migratedFromWalletId: undefined,
        sortIndex: clean.SortIndex
      }
    })
  )
  return { walletInfos, walletStates }
}

/**
 * Loads the modern key state list from the account folder.
 */
async function loadWalletStates(disklet: Disklet): Promise<EdgeWalletStates> {
  const out: EdgeWalletStates = {}
  const paths = justFiles(await disklet.list('Keys'))
  await Promise.all(
    paths.map(async path => {
      const clean = await walletStateFile.load(disklet, path)
      if (clean == null) return
      const { id, archived, deleted, hidden, migratedFromWalletId, sortIndex } =
        clean
      out[id] = { archived, deleted, hidden, sortIndex, migratedFromWalletId }
    })
  )

  return out
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
  const accountState = ai.props.state.accounts[accountId]
  const { accountWalletInfo, accountWalletInfos } = accountState

  // Read legacy files from all Airbitz repos:
  const legacyLists: LoadedWalletList[] = await Promise.all(
    accountWalletInfos.map(info =>
      loadWalletList(getStorageWalletDisklet(ai.props.state, info.id))
    )
  )

  // Read states from the primary Edge repo:
  const newStates = await loadWalletStates(
    getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)
  )

  // Merge all that information together:
  const legacyWalletInfos: EdgeWalletInfo[] = []
  for (const files of legacyLists) {
    legacyWalletInfos.push(...files.walletInfos)
  }
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
  const disklet = getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)

  // Find the changes between the new states and the old states:
  const toWrite: EdgeWalletStates = {}
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
  if (walletIds.length < 1) return

  await Promise.all(
    walletIds.map(async walletId => {
      const { archived, deleted, hidden, migratedFromWalletId, sortIndex } =
        toWrite[walletId]
      const walletIdHash = hashStorageWalletFilename(
        ai.props.state,
        accountWalletInfo.id,
        walletId
      )
      await walletStateFile.save(disklet, `Keys/${walletIdHash}.json`, {
        archived,
        deleted,
        hidden,
        id: walletId,
        migratedFromWalletId,
        sortIndex
      })
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
  const disklet = getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)

  // Write the new state to disk:
  const clean =
    (await pluginSettingsFile.load(disklet, PLUGIN_SETTINGS_FILE)) ??
    emptySettings
  await pluginSettingsFile.save(disklet, PLUGIN_SETTINGS_FILE, {
    ...clean,
    userSettings: {
      ...ai.props.state.accounts[accountId].userSettings,
      [pluginId]: userSettings
    }
  })

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
  const disklet = getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)

  // Write the new state to disk:
  const clean =
    (await pluginSettingsFile.load(disklet, PLUGIN_SETTINGS_FILE)) ??
    emptySettings
  await pluginSettingsFile.save(disklet, PLUGIN_SETTINGS_FILE, {
    ...clean,
    swapSettings: {
      ...ai.props.state.accounts[accountId].swapSettings,
      [pluginId]: swapSettings
    }
  })

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
  const disklet = getStorageWalletDisklet(ai.props.state, accountWalletInfo.id)

  const clean = await pluginSettingsFile.load(disklet, PLUGIN_SETTINGS_FILE)
  const { userSettings, swapSettings } = clean ?? {
    userSettings: {},
    swapSettings: {}
  }

  // Add the final list to Redux:
  ai.props.dispatch({
    type: 'ACCOUNT_PLUGIN_SETTINGS_LOADED',
    payload: { accountId, userSettings, swapSettings }
  })
}

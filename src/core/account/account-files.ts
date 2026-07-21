import { Disklet, justFiles } from 'disklet'
import { base64 } from 'rfc4648'

import { EdgeWalletInfo, EdgeWalletStates } from '../../types/types'
import { makeJsonFile } from '../../util/file-helpers'
import { makeKeyInfo } from '../login/keys'
import { wasEdgeStorageKeys } from '../login/storage-keys'
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
 * Waits until the account's storage wallet exists. A cache-seeded
 * login emits the account API object before `addStorageWallet` runs,
 * so methods that touch the synced repo pend briefly instead of
 * throwing during that window. Rejects if the account logs out.
 */
export function waitForAccountRepo(
  ai: ApiInput,
  accountId: string
): Promise<unknown> {
  return ai.waitFor(props => {
    const accountState = props.state.accounts[accountId]
    if (accountState == null) {
      throw new Error('The account was logged out')
    }
    const { accountWalletInfo } = accountState
    if (props.state.storageWallets[accountWalletInfo.id] != null) return true

    // The repo is still missing. If the boot loads failed terminally,
    // it is never coming, so reject instead of pending forever:
    if (accountState.loadFailure != null) throw accountState.loadFailure
  })
}

/**
 * Waits until the account's wallet states have loaded from disk.
 * A cache-seeded login holds possibly-stale wallet states, so a
 * change based on those could no-op against a value the load is
 * about to overwrite. Rejects if the account logs out or the boot
 * loads fail terminally.
 */
export function waitForWalletStates(
  ai: ApiInput,
  accountId: string
): Promise<unknown> {
  return ai.waitFor(props => {
    const accountState = props.state.accounts[accountId]
    if (accountState == null) {
      throw new Error('The account was logged out')
    }
    if (accountState.walletStatesLoaded) return true
    if (accountState.loadFailure != null) throw accountState.loadFailure
  })
}

/**
 * Waits until the account's plugin settings have loaded from disk.
 * The settings writers rebuild the whole on-disk map from Redux, so
 * writing before the load would wipe other plugins' settings. Rejects
 * if the account logs out or the boot loads fail terminally.
 */
export function waitForPluginSettings(
  ai: ApiInput,
  accountId: string
): Promise<unknown> {
  return ai.waitFor(props => {
    const accountState = props.state.accounts[accountId]
    if (accountState == null) {
      throw new Error('The account was logged out')
    }
    if (accountState.pluginSettingsLoaded) return true
    if (accountState.loadFailure != null) throw accountState.loadFailure
  })
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
        ...wasEdgeStorageKeys({
          dataKey: clean.MK,
          syncKey: clean.SyncKey
        }),
        bitcoinKey: base64.stringify(clean.BitcoinSeed),
        format: 'bip32'
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
  // The load implies the repo exists, and it makes the diff below
  // compare against authoritative records instead of cached ones:
  await waitForWalletStates(ai, accountId)
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
    payload: {
      accountId,
      walletStates: { ...walletStates, ...toWrite },
      changedIds: walletIds
    }
  })
}

/**
 * Changes a currency plugin's settings within an account.
 */
export async function changePluginUserSettings(
  ai: ApiInput,
  accountId: string,
  pluginId: string,
  userSettings: object
): Promise<void> {
  await waitForPluginSettings(ai, accountId)
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
  await waitForPluginSettings(ai, accountId)
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

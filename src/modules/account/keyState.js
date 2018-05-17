import { mapFiles } from 'disklet'

import { base16, base64 } from '../../util/encoding.js'
import { makeKeyInfo } from '../login/keys.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../storage/storage-selectors.js'

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

function getJsonFiles (folder) {
  return mapFiles(folder, (file, name) =>
    file
      .getText()
      .then(text => ({ file, name, json: JSON.parse(text) }))
      .catch(e => void 0)
  ).then(files => files.filter(file => file != null))
}

/**
 * Loads the legacy wallet list from the account folder.
 */
function loadWalletList (folder) {
  return getJsonFiles(folder.folder('Wallets')).then(files => {
    const keyInfos = []
    const keyStates = {}

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
      keyInfos.push(keyInfo)
      keyStates[keyInfo.id] = {
        sortIndex: SortIndex,
        archived: Archived,
        deleted: false
      }
    })

    return { keyInfos, keyStates }
  })
}

/**
 * Loads the modern key state list from the account folder.
 */
function loadKeyStates (folder) {
  return getJsonFiles(folder.folder('Keys')).then(files => {
    const keyStates = []

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
export function loadAllKeyStates (state, keyId) {
  const folder = getStorageWalletFolder(state, keyId)

  return Promise.all([loadWalletList(folder), loadKeyStates(folder)]).then(
    values => {
      const [{ keyInfos, keyStates: legacyKeyStates }, newKeyStates] = values
      const keyStates = { ...legacyKeyStates, ...newKeyStates }
      return { keyInfos, keyStates }
    }
  )
}

/**
 * Writes some key states to the account folder.
 */
function saveKeyStates (state, keyId, keyStates) {
  const keyFolder = getStorageWalletFolder(state, keyId).folder('Keys')

  // If there are no changes, do nothing:
  const walletIds = Object.keys(keyStates)
  if (!walletIds.length) return Promise.resolve()

  return Promise.all(
    walletIds.map(walletId => {
      const { archived, deleted, sortIndex } = keyStates[walletId]
      const walletIdHash = hashStorageWalletFilename(state, keyId, walletId)
      return keyFolder
        .file(`${walletIdHash}.json`)
        .setText(JSON.stringify({ archived, deleted, sortIndex, id: walletId }))
    })
  )
}

/**
 * Given a list of new key states, as well as the existing list,
 * writes out the ones that have changed, and returns the combined list.
 */
export function changeKeyStates (state, keyId, keyStates, newStates) {
  // Find the changes between the new states and the old states:
  const toWrite = {}
  for (const id of Object.keys(newStates)) {
    if (keyStates[id] == null) {
      // We don't have this id, so everything is new:
      toWrite[id] = newStates[id]
    } else if (different(keyStates[id], newStates[id])) {
      // We already have this id, so only update if it has changed:
      toWrite[id] = { ...keyStates[id], ...newStates[id] }
    }
  }

  return saveKeyStates(state, keyId, toWrite).then(() => ({
    ...keyStates,
    ...toWrite
  }))
}

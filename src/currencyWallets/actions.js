import { makeStorageState } from '../storage/storageState.js'
import { makeReaction, unwatched } from '../util/derive.js'
import { add, setName, addTxs, setFile, setFiles } from './reducer.js'
import { getStorageWallet } from './selectors.js'
import { mapFiles } from 'disklet'

function nop () {}

/**
 * Creates the initial state for a currency wallet and adds it to the store.
 * @param opts The options passed to `createCurrencyWallet`.
 * @return A `Promise` that will resolve when the state is ready.
 */
export function addCurrencyWallet (keyInfo, opts = {}) {
  return dispatch => {
    const { io, plugin, callbacks = {} } = opts
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onDataChanged = nop
    } = callbacks

    return makeStorageState(keyInfo, {
      io,
      callbacks: { onDataChanged }
    }).then(storage => {
      const keyId = keyInfo.id

      // Create the currency plugin:
      const engine = plugin.makeEngine(keyInfo, {
        walletLocalFolder: storage.localFolder,
        walletFolder: storage.folder,
        callbacks: {
          onAddressesChecked,
          onBalanceChanged,
          onBlockHeightChanged,
          onTransactionsChanged (txs) {
            dispatch(addTxs(keyId, txs))
          }
        }
      })

      // Add the wallet to the store:
      dispatch(add(keyId, { keyId, engine, plugin, storage }))

      // Sign up for events:
      const disposer = makeReaction(() => {
        storage.epoch()
        return dispatch(unwatched(loadFiles(keyId)))
      })
      return disposer.result.then(() => keyInfo.id)
    })
  }
}

/**
 * Changes a wallet's name.
 */
export function renameCurrencyWallet (keyId, name) {
  return (dispatch, getState) =>
    getStorageWallet(getState(), keyId)
      .folder.file('WalletName.json')
      .setText(JSON.stringify({ walletName: name }))
      .then(() => dispatch(setName(keyId, name)))
}

/**
 * Updates the wallet in response to data syncs.
 */
function loadFiles (keyId) {
  return (dispatch, getState) => {
    const folder = getStorageWallet(getState(), keyId).folder

    return Promise.all([
      // Wallet name:
      folder
        .file('WalletName.json')
        .getText()
        .then(text => JSON.parse(text).walletName)
        .catch(e => null)
        .then(name => dispatch(setName(keyId, name))),
      // Transaction metadata:
      mapFiles(folder.folder('transaction'), file =>
        file.getText().then(text => JSON.parse(text)).catch(e => null)
      ).then(files => {
        const out = {}
        const jsons = files.filter(json => json != null && json.txid != null)
        for (const json of jsons) {
          out[json.txid] = json
        }
        return dispatch(setFiles(keyId, out))
      })
    ])
  }
}

/**
 * Changes a wallet's metadata.
 */
export function setCurrencyWalletTxMetadata (keyId, txid, json) {
  return (dispatch, getState) => {
    const folder = getStorageWallet(getState(), keyId).folder

    return folder
      .folder('transaction')
      .file(txid + '.json')
      .setText(JSON.stringify(json))
      .then(() => dispatch(setFile(keyId, txid, json)))
  }
}

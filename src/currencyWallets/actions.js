import { makeStorageState } from '../storage/storageState.js'
import { derive, makeReaction, unwatched } from '../util/derive.js'
import { add, setName, addTxs, setFile, setFiles } from './reducer.js'
import { getCurrencyWallet } from './selectors.js'
import { mapFiles } from 'disklet'

function nop () {}

/**
 * Creates the initial state for a currency wallet and adds it to the store.
 * @param state A deriver for the module's state slice.
 * @return A deriver for the wallet's state.
 */
export function addCurrencyWallet (state, keyInfo, opts = {}) {
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
      const currencyWallet = derive(() => getCurrencyWallet(state(), keyId))

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
        return dispatch(unwatched(loadFiles(currencyWallet)))
      })
      return disposer.result.then(() => currencyWallet)
    })
  }
}

/**
 * Changes a wallet's name.
 * @param currencyWallet A deriver for the wallet's state.
 */
export function renameCurrencyWallet (currencyWallet, name) {
  return dispatch =>
    currencyWallet().storage.folder
      .file('WalletName.json')
      .setText(JSON.stringify({ walletName: name }))
      .then(() => dispatch(setName(currencyWallet().keyId, name)))
}

/**
 * Updates the wallet in response to data syncs.
 * @param currencyWallet A deriver for the wallet's state.
 */
function loadFiles (currencyWallet) {
  return dispatch => {
    const folder = currencyWallet().storage.folder
    const keyId = currencyWallet().keyId
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
 * @param currencyWallet A deriver for the wallet's state.
 */
export function setMetadata (currencyWallet, txid, json) {
  return dispatch => {
    const folder = currencyWallet().storage.folder
    const keyId = currencyWallet().keyId
    return folder
      .folder('transaction')
      .file(txid + '.json')
      .setText(JSON.stringify(json))
      .then(() => dispatch(setFile(keyId, txid, json)))
  }
}

import { makeStorageState } from '../storage/storageState.js'
import { derive, makeReaction, unwatched } from '../util/derive.js'
import { add, setName } from './reducer.js'
import { getCurrencyWallet } from './selectors.js'

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
      onDataChanged = nop,
      onTransactionsChanged = nop
    } = callbacks

    return makeStorageState(keyInfo, {
      io,
      callbacks: { onDataChanged }
    }).then(storage => {
      const currencyWallet = derive(() =>
        getCurrencyWallet(state(), keyInfo.id)
      )

      // Currency plugin:
      const engine = plugin.makeEngine(keyInfo, {
        walletLocalFolder: storage.localFolder,
        walletFolder: storage.folder,
        callbacks: {
          onAddressesChecked,
          onBalanceChanged,
          onBlockHeightChanged,
          onTransactionsChanged
        }
      })

      // Add the wallet to the store:
      dispatch(
        add(keyInfo.id, {
          engine,
          keyId: keyInfo.id,
          name: null,
          plugin,
          storage
        })
      )

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
  return dispatch =>
    currencyWallet().storage.folder
      .file('WalletName.json')
      .getText()
      .then(text => JSON.parse(text).walletName)
      .catch(e => null)
      .then(name => dispatch(setName(currencyWallet().keyId, name)))
}

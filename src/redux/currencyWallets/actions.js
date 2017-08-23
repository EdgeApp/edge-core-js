import { createReaction } from '../../util/reaction.js'
import { mergeDeeply } from '../../util/util.js'
import { addStorageWallet } from '../actions.js'
import {
  getCurrencyMultiplier,
  getCurrencyWalletFiat,
  getCurrencyWalletFile,
  getCurrencyWalletPlugin,
  getExchangeRate,
  getStorageWalletFolder,
  getStorageWalletLastSync,
  getStorageWalletLocalFolder,
  hashStorageWalletFilename
} from '../selectors.js'
import {
  add,
  addTxs,
  setBalance,
  setBlockHeight,
  setEngine,
  setFile,
  setFiles,
  setName,
  setProgress
} from './reducer.js'
import { mapFiles } from 'disklet'

function getTxFile (state, keyId, timestamp, txid) {
  const txidHash = hashStorageWalletFilename(state, keyId, txid)
  const filename = `${timestamp}-${txidHash}.json`

  return getStorageWalletFolder(state, keyId)
    .folder('transaction')
    .file(filename)
}

/**
 * Creates the initial state for a currency wallet and adds it to the store.
 * @param opts The options passed to `createCurrencyWallet`.
 * @return A `Promise` that will resolve when the state is ready.
 */
export function addCurrencyWallet (keyInfo, opts = {}) {
  return (dispatch, getState) => {
    const { plugin } = opts
    if (plugin.currencyInfo == null) {
      plugin.currencyInfo = plugin.getInfo()
    }

    return dispatch(addStorageWallet(keyInfo)).then(() => {
      const state = getState()
      const keyId = keyInfo.id

      // Add the wallet to the store:
      dispatch(add(keyId, { plugin }))

      // Create the currency plugin:
      const defaultCurrency = plugin.currencyInfo.currencyCode
      const engine = plugin.makeEngine(keyInfo, {
        walletFolder: getStorageWalletFolder(state, keyId),
        walletLocalFolder: getStorageWalletLocalFolder(state, keyId),
        callbacks: {
          onAddressesChecked (ratio) {
            dispatch(setProgress(keyId, ratio))
          },

          onBalanceChanged (currencyCode, balance) {
            dispatch(setBalance(keyId, { currencyCode, balance }))
          },

          onBlockHeightChanged (height) {
            dispatch(setBlockHeight(keyId, height))
          },

          onTransactionsChanged (txs) {
            if (!txs) return
            dispatch(addTxs(keyId, txs, defaultCurrency))
          }
        }
      })

      return Promise.resolve(engine).then(engine => {
        dispatch(setEngine(keyId, engine))

        // Sign up for events:
        const disposer = dispatch(
          createReaction(
            state => getStorageWalletLastSync(state, keyId),
            timestamp => dispatch => dispatch(loadFiles(keyId))
          )
        )
        return disposer.payload.out.then(() => keyInfo.id)
      })
    })
  }
}

/**
 * Changes a wallet's name.
 */
export function renameCurrencyWallet (keyId, name) {
  return (dispatch, getState) =>
    getStorageWalletFolder(getState(), keyId)
      .file('WalletName.json')
      .setText(JSON.stringify({ walletName: name }))
      .then(() => dispatch(setName(keyId, name)))
}

/**
 * Updates the wallet in response to data syncs.
 */
function loadFiles (keyId) {
  return (dispatch, getState) => {
    const folder = getStorageWalletFolder(getState(), keyId)

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
export function setCurrencyWalletTxMetadata (
  keyId,
  txid,
  currencyCode,
  metadata
) {
  return (dispatch, getState) => {
    const state = getState()
    const folder = getStorageWalletFolder(state, keyId)
    const oldFile = getCurrencyWalletFile(state, keyId, txid)
    const newFile = {
      txid,
      internal: false,
      currencies: {}
    }
    newFile.currencies[currencyCode] = {
      metadata
    }
    const file = mergeDeeply(oldFile, newFile)

    // Ensure we have a date:
    if (oldFile == null) {
      file.creationDate = Date.now() / 1000
    }

    // Save the new file:
    dispatch(setFile(keyId, txid, file))
    return folder
      .folder('transaction')
      .file(txid + '.json')
      .setText(JSON.stringify(file))
      .then(() => void 0)
  }
}

export function setupNewTxMetadata (keyId, tx) {
  return (dispatch, getState) => {
    const state = getState()
    const fiatCurrency = getCurrencyWalletFiat(state, keyId)
    const txid = tx.txid
    const txFile = getTxFile(state, keyId, 0, txid)

    // Basic file template:
    const file = {
      txid,
      internal: true,
      creationDate: Date.now() / 1000,
      currencies: {}
    }

    // Trick `getCurrencyMultiplier` into using our plugin:
    const fakeState = {
      plugins: { currencyPlugins: [getCurrencyWalletPlugin(state, keyId)] }
    }

    // Set up exchange-rate metadata:
    for (const currency of Object.keys(tx.nativeAmount)) {
      const rate =
        getExchangeRate(state, currency, fiatCurrency, () => 1) /
        getCurrencyMultiplier(fakeState, currency)
      const nativeAmount = tx.nativeAmount[currency]

      const metadata = { exchangeAmount: {} }
      metadata.exchangeAmount[fiatCurrency] = rate * nativeAmount
      file.currencies[currency] = { metadata, nativeAmount }
    }

    // Save the new file:
    dispatch(setFile(keyId, txid, file))
    return txFile.setText(JSON.stringify(file)).then(() => void 0)
  }
}

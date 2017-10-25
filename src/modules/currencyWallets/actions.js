import { number as currencyFromNumber } from 'currency-codes'
import { mapFiles } from 'disklet'
import { createReaction } from '../../util/redux/reaction.js'
import { mergeDeeply } from '../../util/util.js'
import { addStorageWallet } from '../actions.js'
import {
  getCurrencyMultiplier,
  getCurrencyPlugin
} from '../currency/currency-selectors.js'
import {
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
  setFiat,
  setFile,
  setFiles,
  setName,
  setProgress
} from './reducer.js'
import {
  getCurrencyWalletFiat,
  getCurrencyWalletFile,
  getCurrencyWalletPlugin
} from './selectors.js'

function getTxFile (state, keyId, timestamp, txid) {
  const txidHash = hashStorageWalletFilename(state, keyId, txid)
  const filename = `${timestamp}-${txidHash}.json`

  return getStorageWalletFolder(state, keyId)
    .folder('transaction')
    .file(filename)
}

/**
 * Creates the initial state for a currency wallet and adds it to the store.
 * @return A `Promise` that will resolve when the state is ready.
 */
export function addCurrencyWallet (keyInfo, ai) {
  return async (dispatch, getState) => {
    const plugin = getCurrencyPlugin(
      ai.props.output.currency.plugins,
      keyInfo.type
    )
    if (plugin.currencyInfo == null) {
      plugin.currencyInfo = plugin.getInfo()
    }

    // Add the wallet to the store:
    const keyId = keyInfo.id
    dispatch(add(keyId, { plugin }))

    // Start the data sync:
    await dispatch(addStorageWallet(keyInfo))
    const state = getState()

    // Create the currency plugin:
    const defaultCurrency = plugin.currencyInfo.currencyCode
    const engine = await Promise.resolve(
      plugin.makeEngine(keyInfo, {
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
    )
    dispatch(setEngine(keyId, engine))
    await engine.startEngine()

    // Sign up for events:
    const disposer = dispatch(
      createReaction(
        state => getStorageWalletLastSync(state, keyId),
        timestamp => dispatch => dispatch(loadFiles(keyId))
      )
    )
    return disposer.payload.out.then(() => keyInfo.id)
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
 * Changes a wallet's fiat currency code.
 */
export function setCurrencyWalletFiat (keyId, fiatCurrencyCode) {
  if (!/^iso:/.test(fiatCurrencyCode)) {
    throw new TypeError('Fiat currency codes must start with `iso:`')
  }

  return (dispatch, getState) =>
    getStorageWalletFolder(getState(), keyId)
      .file('Currency.json')
      .setText(JSON.stringify({ fiat: fiatCurrencyCode }))
      .then(() => dispatch(setFiat(keyId, fiatCurrencyCode)))
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
        .then(name => dispatch(setName(keyId, name)))
        .catch(e => dispatch(setName(keyId, null))),

      folder
        .file('Currency.json')
        .getText()
        .then(text => JSON.parse(text))
        .then(file =>
          dispatch(
            setFiat(
              keyId,
              file.fiat ? file.fiat : 'iso:' + currencyFromNumber(file.num).code
            )
          )
        )
        .catch(e => dispatch(setCurrencyWalletFiat(keyId, 'iso:USD'))),

      // Transaction metadata:
      mapFiles(folder.folder('transaction'), file =>
        file
          .getText()
          .then(text => JSON.parse(text))
          .catch(e => null)
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
    const txFile = getTxFile(state, keyId, 0, txid)
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
    return txFile.setText(JSON.stringify(file)).then(() => void 0)
  }
}

export function setupNewTxMetadata (keyId, tx) {
  return (dispatch, getState) => {
    const state = getState()
    const fiatCurrency = getCurrencyWalletFiat(state, keyId)
    const txid = tx.txid
    const txFile = getTxFile(state, keyId, 0, txid)
    const currencyInfo = getCurrencyWalletPlugin(state, keyId).currencyInfo

    // Basic file template:
    const file = {
      txid,
      internal: true,
      creationDate: Date.now() / 1000,
      currencies: {}
    }

    // Set up exchange-rate metadata:
    for (const currency of Object.keys(tx.nativeAmount)) {
      const rate =
        getExchangeRate(state, currency, fiatCurrency, () => 1) /
        getCurrencyMultiplier([currencyInfo], currency)
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

// @flow
import { number as currencyFromNumber } from 'currency-codes'
import { mapFiles } from 'disklet'
import { mergeDeeply } from '../../../util/util.js'
import {
  getExchangeRate,
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../../selectors.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'

function getTxFile (state, keyId, timestamp, txid) {
  const txidHash = hashStorageWalletFilename(state, keyId, txid)
  const filename = `${timestamp}-${txidHash}.json`

  return getStorageWalletFolder(state, keyId)
    .folder('transaction')
    .file(filename)
}

/**
 * Changes a wallet's name.
 */
export function renameCurrencyWallet (
  input: CurrencyWalletInput,
  name: string | null
) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  return getStorageWalletFolder(state, walletId)
    .file('WalletName.json')
    .setText(JSON.stringify({ walletName: name }))
    .then(() =>
      dispatch({
        type: 'CURRENCY_WALLET_NAME_CHANGED',
        payload: { name, walletId }
      })
    )
}

/**
 * Changes a wallet's fiat currency code.
 */
export function setCurrencyWalletFiat (
  input: CurrencyWalletInput,
  fiatCurrencyCode: string
) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  if (!/^iso:/.test(fiatCurrencyCode)) {
    throw new TypeError('Fiat currency codes must start with `iso:`')
  }

  return getStorageWalletFolder(state, walletId)
    .file('Currency.json')
    .setText(JSON.stringify({ fiat: fiatCurrencyCode }))
    .then(() =>
      dispatch({
        type: 'CURRENCY_WALLET_FIAT_CHANGED',
        payload: { fiatCurrencyCode, walletId }
      })
    )
}

/**
 * Updates the wallet in response to data syncs.
 */
export function loadAllFiles (input: CurrencyWalletInput) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  const folder = getStorageWalletFolder(state, walletId)

  return Promise.all([
    // Wallet name:
    folder
      .file('WalletName.json')
      .getText()
      .then(text => JSON.parse(text).walletName)
      .then((name: string | null) =>
        dispatch({
          type: 'CURRENCY_WALLET_NAME_CHANGED',
          payload: { name, walletId }
        })
      )
      .catch(e => {
        const name: string | null = null
        dispatch({
          type: 'CURRENCY_WALLET_NAME_CHANGED',
          payload: { name, walletId }
        })
      }),

    folder
      .file('Currency.json')
      .getText()
      .then(text => JSON.parse(text))
      .then(file =>
        dispatch({
          type: 'CURRENCY_WALLET_FIAT_CHANGED',
          payload: {
            fiatCurrencyCode: file.fiat
              ? file.fiat
              : 'iso:' + currencyFromNumber(file.num).code,
            walletId
          }
        })
      )
      .catch(e =>
        dispatch({
          type: 'CURRENCY_WALLET_FIAT_CHANGED',
          payload: { fiatCurrencyCode: 'iso:USD', walletId }
        })
      ),

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
      return dispatch({
        type: 'CURRENCY_WALLET_FILES_LOADED',
        payload: { files: out, walletId }
      })
    })
  ])
}

/**
 * Changes a wallet's metadata.
 */
export function setCurrencyWalletTxMetadata (
  input: CurrencyWalletInput,
  txid: string,
  currencyCode: string,
  metadata: any
) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  const txFile = getTxFile(state, walletId, 0, txid)
  const oldFile = input.props.selfState.files[txid]
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
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { json: file, txid, walletId }
  })
  return txFile.setText(JSON.stringify(file)).then(() => void 0)
}

export function setupNewTxMetadata (input: CurrencyWalletInput, tx: any) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  const txid = tx.txid
  const txFile = getTxFile(state, walletId, 0, txid)
  const currencyInfo = input.props.selfState.currencyInfo
  const fiatCurrency: string = input.props.selfState.fiat || 'iso:USD'

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
      parseFloat(getCurrencyMultiplier([currencyInfo], currency))
    const nativeAmount = tx.nativeAmount[currency]

    const metadata = { exchangeAmount: {} }
    metadata.exchangeAmount[fiatCurrency] = rate * nativeAmount
    file.currencies[currency] = { metadata, nativeAmount }
  }

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { json: file, txid, walletId }
  })
  return txFile.setText(JSON.stringify(file)).then(() => void 0)
}

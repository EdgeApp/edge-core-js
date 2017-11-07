// @flow
import { number as currencyFromNumber } from 'currency-codes'
import { mapFiles } from 'disklet'

import { mergeDeeply } from '../../../util/util.js'
import { getExchangeRate } from '../../exchange/selectors.js'
import {
  getStorageWalletFolder,
  hashStorageWalletFilename
} from '../../storage/selectors.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import { combineTxWithFile } from './currency-wallet-api.js'
import { forEachListener } from './currency-wallet-callbacks.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'

type TransactionFile = {
  txid: string,
  internal: boolean,
  creationDate: number,
  currencies: {
    [currencyCode: string]: {
      metadata: {
        bizId?: number,
        category?: string,
        exchangeAmount: { [fiatCurrencyCode: string]: number },
        name?: string,
        notes?: string
      },
      nativeAmount?: string,
      providerFeeSent?: string
    }
  }
}

type LegacyTransactionFile = {
  airbitzFeeWanted: number,
  meta: {
    amountFeeAirBitzSatoshi: number,
    balance: number,
    fee: number,

    // Metadata:
    amountCurrency: number,
    bizId: number,
    category: string,
    name: string,
    notes: string,

    // Obsolete/moved fields:
    attributes: number,
    amountSatoshi: number,
    amountFeeMinersSatoshi: number,
    airbitzFee: number
  },
  ntxid: string,
  state: {
    creationDate: number,
    internal: boolean,
    malleableTxId: string
  }
}

/**
 * Converts a LegacyTransactionFile to a TransactionFile.
 */
function fixLegacyFile (
  file: LegacyTransactionFile,
  walletCurrency: string,
  walletFiat: string
) {
  const out: TransactionFile = {
    creationDate: file.state.creationDate,
    currencies: {},
    internal: file.state.internal,
    txid: file.state.malleableTxId
  }
  out.currencies[walletCurrency] = {
    metadata: {
      bizId: file.meta.bizId,
      category: file.meta.category,
      exchangeAmount: {},
      name: file.meta.name,
      notes: file.meta.notes
    },
    providerFeeSent: file.meta.amountFeeAirBitzSatoshi.toFixed()
  }
  out.currencies[walletCurrency].metadata.exchangeAmount[walletFiat] =
    file.meta.amountCurrency

  return out
}

function getTxFile (state, keyId: string, timestamp: number, txid: string) {
  const txidHash = hashStorageWalletFilename(state, keyId, txid)
  const filename = `${timestamp.toFixed(0)}-${txidHash}.json`

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
 * Loads the wallet fiat currency file.
 */
function loadFiatFile (input: CurrencyWalletInput, folder) {
  const walletId = input.props.id
  const { dispatch } = input.props

  return folder
    .file('Currency.json')
    .getText()
    .then(text => {
      const file = JSON.parse(text)
      return file.fiat ? file.fiat : 'iso:' + currencyFromNumber(file.num).code
    })
    .catch(e => 'iso:USD')
    .then((fiatCurrencyCode: string) => {
      dispatch({
        type: 'CURRENCY_WALLET_FIAT_CHANGED',
        payload: { fiatCurrencyCode, walletId }
      })
      return fiatCurrencyCode
    })
}

/**
 * Loads the wallet name file.
 */
function loadNameFile (input: CurrencyWalletInput, folder) {
  const walletId = input.props.id
  const { dispatch } = input.props

  return folder
    .file('WalletName.json')
    .getText()
    .then(text => JSON.parse(text).walletName)
    .catch(e => null)
    .then((name: string | null) =>
      dispatch({
        type: 'CURRENCY_WALLET_NAME_CHANGED',
        payload: {
          name: typeof name === 'string' ? name : null,
          walletId
        }
      })
    )
}

/**
 * Loads transaction metadata files.
 */
function loadTxFiles (input: CurrencyWalletInput, folder) {
  const walletId = input.props.id
  const { dispatch } = input.props
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  // Actually load the files:
  const allFiles = Promise.all([
    // Transaction metadata:
    mapFiles(folder.folder('transaction'), file =>
      file
        .getText()
        .then(text => JSON.parse(text))
        .catch(e => null)
    ),

    // Legacy transaction metadata:
    mapFiles(folder.folder('Transactions'), file =>
      file
        .getText()
        .then(text => JSON.parse(text))
        .catch(e => null)
    )
  ])

  // Save the results to redux:
  return allFiles.then(allFiles => {
    const [newFiles, oldFiles] = allFiles

    const out = {}
    for (const json of oldFiles) {
      if (json == null || !json.state) continue
      const txid = json.state.malleableTxId
      if (!txid) continue

      out[txid] = fixLegacyFile(json, walletCurrency, walletFiat)
    }
    for (const json of newFiles) {
      if (json == null || !json.txid) continue
      out[json.txid] = json
    }

    dispatch({
      type: 'CURRENCY_WALLET_FILES_LOADED',
      payload: { files: out, walletId }
    })
    return out
  })
}

/**
 * Updates the wallet in response to data syncs.
 */
export async function loadAllFiles (input: CurrencyWalletInput) {
  const walletId = input.props.id
  const folder = getStorageWalletFolder(input.props.state, walletId)

  await loadFiatFile(input, folder)
  await loadNameFile(input, folder)
  await loadTxFiles(input, folder)
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

  // Find the tx:
  const tx = input.props.selfState.txs[txid]
  if (!tx) {
    throw new Error(`Setting metatdata for missing tx ${txid}`)
  }

  // Load the old file:
  const oldFile = input.props.selfState.files[txid]
  const creationDate =
    oldFile == null ? Date.now() / 1000 : oldFile.creationDate

  // Set up the new file:
  const txFile = getTxFile(state, walletId, creationDate, txid)
  const newFile: TransactionFile = {
    txid,
    internal: false,
    creationDate,
    currencies: {}
  }
  newFile.currencies[currencyCode] = {
    metadata
  }
  const file = mergeDeeply(oldFile, newFile)

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { json: file, txid, walletId }
  })
  return txFile.setText(JSON.stringify(file)).then(() => {
    const callbackTx = combineTxWithFile(input, tx, file, currencyCode)
    forEachListener(input, ({ onTransactionsChanged }) => {
      if (onTransactionsChanged) {
        onTransactionsChanged(walletId, [callbackTx])
      }
    })

    return void 0
  })
}

export function setupNewTxMetadata (input: CurrencyWalletInput, tx: any) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  const txid = tx.txid
  const txFile = getTxFile(state, walletId, Date.now() / 1000, txid)
  const currencyInfo = input.props.selfState.currencyInfo
  const fiatCurrency: string = input.props.selfState.fiat || 'iso:USD'

  // Basic file template:
  const file: TransactionFile = {
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

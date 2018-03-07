// @flow

import { number as currencyFromNumber } from 'currency-codes'
import { mapFiles } from 'disklet'

import { mergeDeeply } from '../../../util/util.js'
import { fetchAppIdInfo } from '../../account/lobbyApi.js'
import { getExchangeRate } from '../../exchange/selectors.js'
import {
  getStorageWalletFolder,
  getStorageWalletLocalFolder,
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

type LegacyAddressFile = {
  seq: number, // index
  address: string,
  state: {
    recycleable: boolean,
    creationDate: number
  },
  meta: {
    amountSatoshi: number // requestAmount
    // TODO: Normal EdgeMetatada
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

function getTxFile (state: any, keyId: string, date: number, txid: string) {
  const txidHash = hashStorageWalletFilename(state, keyId, txid)
  const timestamp = date.toFixed(0)

  return [
    txidHash,
    getStorageWalletFolder(state, keyId)
      .folder('transaction')
      .file(`${timestamp}-${txidHash}.json`)
  ]
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
    .catch(async e => {
      // The wallet info does happen to have full data, so this works:
      const fullWalletInfo: any = input.props.selfState.walletInfo
      const name = await fetchBackupName(input, fullWalletInfo.appIds || [])
      if (name != null) await renameCurrencyWallet(input, name)
      return name
    })
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
 * If a wallet has no name file, try to pick a name based on the appId.
 */
function fetchBackupName (
  input: CurrencyWalletInput,
  appIds: Array<string>
): Promise<string | null> {
  // Dirty type hack, but `io` and `onError` do exist on both objects:
  const ai: any = input
  for (const appId of appIds) {
    if (appId !== '') {
      return fetchAppIdInfo(ai, appId).then(info => info.displayName)
    }
  }

  return Promise.resolve(null)
}

/**
 * Loads transaction metadata files.
 */
export async function loadTxFiles (
  input: CurrencyWalletInput,
  missingTxids: Array<string>
): any {
  const walletId = input.props.id
  const folder = getStorageWalletFolder(input.props.state, walletId)
  const { dispatch, state, selfState } = input.props
  const fileNames = missingTxids.map(txid => {
    const txidHash = hashStorageWalletFilename(state, walletId, txid)
    const timestamp = selfState.fileNames[txidHash]
    return `${timestamp}-${txidHash}.json`
  })
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  const getFiles = folderName =>
    Promise.all(
      fileNames.map(fileName =>
        folder
          .folder('folderName')
          .file(fileName)
          .getText()
          .then(text => JSON.parse(text))
          .catch(e => null)
      )
    )

  const newFiles = await getFiles('transaction')
  const oldFiles = await getFiles('Transactions')

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
}

/**
 * Return the legacy file names in the new format.
 * If they in the legacy format, convert them to the new format
 * and cache them on disk
 */
async function getLegacyFileNames (state: any, walletId: string, folder) {
  const fixedLegacyFileNames = []
  try {
    // Get the real legacy file names
    const legacyFileNames = await folder.listFiles()
    // Get the non encrypted folder
    const localFolder = getStorageWalletLocalFolder(state, walletId)
    // Get the legacy file names in the format
    const fixedNamesFile = localFolder.file('fixedLegacyFileNames.json')
    const text = await fixedNamesFile.getText()
    const fixedNames = JSON.parse(text)
    const missingLegacyFiles = []
    for (let i = 0; i < legacyFileNames.length; i++) {
      const legacyFileName = legacyFileNames[i]
      const fixedLegacyFileName = fixedNames[legacyFileName]
      // If we already have converted the legacy file name to the new format then just add it results array
      if (fixedLegacyFileName) {
        fixedLegacyFileNames.push(fixedLegacyFileName)
      } else {
        // If we havn't converted it, then open the legacy file and convert it to the new format
        try {
          missingLegacyFiles.push(legacyFileName)
        } catch (e) {}
      }
    }
    const convertFileNames = missingLegacyFiles.map(legacyFileName =>
      folder
        .file(legacyFileName)
        .getText()
        .then(txText => {
          const tx = JSON.parse(txText)
          const txidHash = hashStorageWalletFilename(state, walletId, tx.txid)
          const timestamp = tx.date.toFixed(0)
          fixedNames[legacyFileName] = `${timestamp}-${txidHash}.json`
        })
    )
    if (convertFileNames.length) {
      await Promise.all(convertFileNames)
      await fixedNamesFile.setText(JSON.stringify(fixedNames))
    }
  } catch (e) {}
  return fixedLegacyFileNames
}

/**
 * Loads transaction metadata file names.
 */
async function loadTxFileNames (input: CurrencyWalletInput, folder) {
  const walletId = input.props.id
  const { dispatch, state } = input.props
  const txFileNames = {}
  // New transactions files:
  const fileNames = await folder.folder('transaction').listFiles()
  // Legacy transactions files:
  const legacyFileNames = await getLegacyFileNames(
    state,
    walletId,
    folder.folder('Transactions')
  )
  // Turn arrays into Object
  fileNames.concat(legacyFileNames).forEach(name => {
    name = name.split('.json')[0]
    const [timestamp, txidHash] = name.split('-')
    txFileNames[txidHash] = parseInt(timestamp)
  })

  dispatch({
    type: 'CURRENCY_WALLET_FILE_NAMES_LOADED',
    payload: { fileNames: txFileNames, walletId }
  })
}

/**
 * Loads address metadata files.
 */
function loadAddressFiles (input: CurrencyWalletInput, folder) {
  // Actually load the files:
  const allFiles = Promise.all([
    // Legacy transaction metadata:
    mapFiles(folder.folder('Addresses'), file =>
      file
        .getText()
        .then(text => JSON.parse(text))
        .catch(e => null)
    )
  ])

  // Save the results to our state:
  return allFiles.then(allFiles => {
    const [oldFiles] = allFiles

    const out: Array<string> = []
    for (const json: LegacyAddressFile of oldFiles) {
      if (json == null || !json.state || !json.meta) continue
      const address = json.address
      if (!address || json.state.recycleable) continue
      out.push(address)
    }

    // Load these addresses into the engine:
    const engine = input.props.selfOutput.engine
    if (engine) engine.addGapLimitAddresses(out)

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
  await loadTxFileNames(input, folder)
  await loadAddressFiles(input, folder)
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
  const [txidHash, txFile] = getTxFile(state, walletId, creationDate, txid)
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
    payload: { json: file, txid, walletId, txidHash }
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
  const [txidHash, txFile] = getTxFile(state, walletId, Date.now() / 1000, txid)
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
      parseFloat(
        getCurrencyMultiplier(
          [currencyInfo],
          input.props.state.currency.customTokens,
          currency
        )
      )
    const nativeAmount = tx.nativeAmount[currency]

    const metadata = { exchangeAmount: {} }
    metadata.exchangeAmount[fiatCurrency] = rate * nativeAmount
    file.currencies[currency] = { metadata, nativeAmount }
  }

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { json: file, txid, walletId, txidHash }
  })
  return txFile.setText(JSON.stringify(file)).then(() => void 0)
}

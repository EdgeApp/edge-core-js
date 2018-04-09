// @flow
import { mapFiles } from 'disklet'

import { mergeDeeply } from '../../../util/util.js'
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
import {
  CurrentVersion,
  TxFolders,
  isNewerVersion
} from './currency-wallet-tx-folders.js'

const FILES_METADATA_FILE = 'filesMetadata.json'

export type FileName = string

export type TxidHash = string

export type TxFileMetadata = {
  version: string,
  txidHash: TxidHash,
  creationDate: number,
  token: boolean,
  dropped: boolean
}

export type TxFilesMetadata = {
  [fileName: FileName]: TxFileMetadata
}

export type TransactionFile = {
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

function getCurrentTxFile (
  state: any,
  keyId: string,
  date: number,
  txidHash: TxidHash
) {
  const creationDate = parseInt(date.toFixed(0))
  const fileName = `${creationDate}-${txidHash}.json`
  const fileObject = getStorageWalletFolder(state, keyId)
    .folder(TxFolders[CurrentVersion].folder)
    .file(fileName)
  const fileMetadata: TxFileMetadata = {
    version: CurrentVersion,
    creationDate,
    txidHash,
    dropped: true,
    token: false
  }
  return { fileName, fileMetadata, fileObject }
}

/**
 * Saves transaction metadata file names.
 */
export async function saveFilesMetadata (input: CurrencyWalletInput) {
  const walletId = input.props.id
  const { state } = input.props
  const filesMetadata = input.props.selfState.filesMetadata

  // Get the non encrypted folder and the filename file
  const localFolder = getStorageWalletLocalFolder(state, walletId)
  const file = localFolder.file(FILES_METADATA_FILE)

  // Cache the new results
  try {
    await file.setText(JSON.stringify(filesMetadata))
  } catch (e) {
    input.props.onError(e)
  }
}

/**
 * Loads transaction metadata file names.
 */
export async function loadMetadataFile (
  input: CurrencyWalletInput,
  encryptedFolder: any
) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  // Get the non encrypted folder and the filename file
  const localFolder = getStorageWalletLocalFolder(state, walletId)
  const file = localFolder.file(FILES_METADATA_FILE)

  // Try to load the Cached File-Names map
  let filesMetadata = {}
  try {
    const text = await file.getText()
    filesMetadata = JSON.parse(text)
  } catch (e) {
    input.props.onError(e)
  }

  const newFilesMetadata = {}
  for (const version in TxFolders) {
    try {
      const { folder, converter } = TxFolders[version]
      const txFilesFolder = encryptedFolder.folder(folder)
      const missingNames = []
      await mapFiles(txFilesFolder, (file, fileName) => {
        if (!filesMetadata[fileName]) missingNames.push(fileName)
      })
      const missingFilesMetadata = await converter(
        missingNames,
        state,
        walletId,
        txFilesFolder
      )
      Object.assign(newFilesMetadata, missingFilesMetadata)
    } catch (e) {
      input.props.onError(e)
    }
  }

  // If we had missing tx's, cache the new results
  if (Object.keys(newFilesMetadata).length) {
    filesMetadata = { ...filesMetadata, ...newFilesMetadata }
    try {
      await file.setText(JSON.stringify(filesMetadata))
    } catch (e) {
      input.props.onError(e)
    }
  }

  dispatch({
    type: 'CURRENCY_WALLET_FILES_METADATA_LOADED',
    payload: { filesMetadata, walletId }
  })
}

/**
 * Loads transaction metadata files.
 */
export async function loadTxFiles (
  input: CurrencyWalletInput,
  filesMetadata: TxFilesMetadata
): any {
  const walletId = input.props.id
  const encryptedFolder = getStorageWalletFolder(input.props.state, walletId)
  const { dispatch } = input.props
  const getFiles = []
  const out = {}

  for (const fileName in filesMetadata) {
    const { txidHash, version } = filesMetadata[fileName]
    const { folder, loader } = TxFolders[version]
    const getFile = encryptedFolder
      .folder(folder)
      .file(fileName)
      .getText()
      .then(text => {
        const tx = loader(JSON.parse(text), input)
        if (tx) out[txidHash] = tx
      })
      .catch(e => null)
    getFiles.push(getFile)
  }

  await Promise.all(getFiles)

  dispatch({
    type: 'CURRENCY_WALLET_FILES_LOADED',
    payload: { files: out, walletId }
  })
  return out
}

/**
 * Changes a wallet's metadata.
 */
export async function setCurrencyWalletTxMetadata (
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
  // Init creationDate to now in case we won't find the file
  let creationDate = Date.now()

  // Get the txidHash for this txid
  const newTxidHash = hashStorageWalletFilename(state, walletId, txid)

  // Try and get the old file:
  let oldFile = input.props.selfState.files[newTxidHash]
  let oldFileMetadata = {}
  let oldFileName, latestVersion

  // Get the old file metadata:
  const filesMetadata = input.props.selfState.filesMetadata
  for (const fileName in filesMetadata) {
    const fileMetadata = filesMetadata[fileName]
    const { txidHash, creationDate: oldDate, version } = fileMetadata
    // Try and load the latest version of the file
    if (txidHash === newTxidHash && isNewerVersion(version, latestVersion)) {
      creationDate = oldDate
      latestVersion = version
      oldFileMetadata = fileMetadata
      oldFileName = fileName
      if (version === CurrentVersion) break
    }
  }

  // If we haven't loaded the file into redux, but we have the file on disk try and load the file
  if (!oldFile && oldFileName) {
    try {
      oldFile = await loadTxFiles(input, { [oldFileName]: oldFileMetadata })
      oldFile = oldFile[newTxidHash]
    } catch (e) {
      input.props.onError(e)
    }
  }

  // Set up the new file:
  const { fileName, fileObject, fileMetadata } = getCurrentTxFile(
    state,
    walletId,
    creationDate,
    newTxidHash
  )

  // Merge the new fileMetadata with the old one but keep the new version just in case
  const { version, ...rest } = oldFileMetadata
  Object.assign(fileMetadata, rest)

  // Build the new file object:
  const newFile: TransactionFile = {
    txid,
    internal: false,
    creationDate,
    currencies: {}
  }

  // If we have new metadata add it
  if (metadata) {
    newFile.currencies = {
      [currencyCode]: { metadata }
    }
  }
  const file = mergeDeeply(oldFile, newFile)

  // Dispatch the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { walletId, file, fileName, fileMetadata }
  })

  // Save the new file:
  return fileObject
    .setText(JSON.stringify(file))
    .then(() => {
      const callbackTx = combineTxWithFile(input, tx, file, currencyCode)
      forEachListener(input, ({ onTransactionsChanged }) => {
        if (onTransactionsChanged) {
          onTransactionsChanged(walletId, [callbackTx])
        }
      })
    })
    .catch(e => {})
}

export function setupNewTxMetadata (
  input: CurrencyWalletInput,
  tx: any,
  customFileMetadata: any
): any {
  const walletId = input.props.id
  const { dispatch, state } = input.props
  const txid = tx.txid

  // Create new "fileMetadata", "fileName" and "fileObject"
  const { fileMetadata, fileName, fileObject } = getCurrentTxFile(
    state,
    walletId,
    Date.now() / 1000,
    customFileMetadata.txidHash
  )

  // Combine the new "fileMetadata" with custom "metadata"
  Object.assign(fileMetadata, customFileMetadata)
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

  // Dispatch the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { walletId, file, fileName, fileMetadata }
  })

  // Save the new file:
  fileObject.setText(JSON.stringify(file)).catch(e => input.props.onError(e))

  return file
}

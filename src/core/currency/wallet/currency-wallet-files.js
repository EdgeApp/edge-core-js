// @flow

import { number as currencyFromNumber } from 'currency-codes'
import { type DiskletFile, type DiskletFolder, mapFiles } from 'disklet'

import {
  type EdgeCurrencyEngineCallbacks,
  type EdgeTransaction,
  type EdgeTxSwap
} from '../../../types/types.js'
import { mergeDeeply } from '../../../util/util.js'
import { fetchAppIdInfo } from '../../account/lobby-api.js'
import { getExchangeRate } from '../../exchange/exchange-selectors.js'
import { type ApiInput } from '../../root-pixie.js'
import { type RootState } from '../../root-reducer.js'
import {
  getStorageWalletFolder,
  getStorageWalletLocalFolder,
  hashStorageWalletFilename
} from '../../storage/storage-selectors.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import { combineTxWithFile } from './currency-wallet-api.js'
import { type DiskMetadata, packMetadata } from './currency-wallet-cleaners.js'
import { type CurrencyWalletInput } from './currency-wallet-pixie.js'
import { type TxFileNames } from './currency-wallet-reducer.js'

const LEGACY_MAP_FILE = 'fixedLegacyFileNames.json'
const WALLET_NAME_FILE = 'WalletName.json'
const CURRENCY_FILE = 'Currency.json'

export type TransactionFile = {
  txid: string,
  internal: boolean,
  creationDate: number,
  currencies: {
    [currencyCode: string]: {
      metadata: DiskMetadata,
      nativeAmount?: string,
      providerFeeSent?: string
    }
  },
  payees?: Array<{
    address: string,
    amount: string,
    currency: string,
    tag?: string
  }>,
  swap?: EdgeTxSwap
}

export type LegacyTransactionFile = {
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

export type LegacyAddressFile = {
  seq: number, // index
  address: string,
  state: {
    recycleable: boolean,
    creationDate: number
  },
  meta: {
    amountSatoshi: number // requestAmount
    // TODO: Normal EdgeMetadata
  }
}

// Cache used to quickly look up creation dates for legacy files.
export type LegacyMapFile = {
  [fileName: string]: { timestamp: number, txidHash: string }
}

/**
 * Converts a LegacyTransactionFile to a TransactionFile.
 */
function fixLegacyFile(
  file: LegacyTransactionFile,
  walletCurrency: string,
  walletFiat: string
): TransactionFile {
  const out: TransactionFile = {
    creationDate: file.state.creationDate,
    currencies: {},
    internal: file.state.internal,
    txid: file.state.malleableTxId
  }
  const exchangeAmount = {}
  exchangeAmount[walletFiat] = file.meta.amountCurrency
  out.currencies[walletCurrency] = {
    metadata: {
      bizId: file.meta.bizId,
      category: file.meta.category,
      exchangeAmount,
      name: file.meta.name,
      notes: file.meta.notes
    },
    providerFeeSent: file.meta.amountFeeAirBitzSatoshi.toFixed()
  }

  return out
}

function getTxFile(
  state: RootState,
  keyId: string,
  creationDate: number,
  txid: string
): { diskletFile: DiskletFile, fileName: string, txidHash: string } {
  const txidHash: string = hashStorageWalletFilename(state, keyId, txid)
  const fileName: string = `${creationDate.toFixed(0)}-${txidHash}.json`
  return {
    diskletFile: getStorageWalletFolder(state, keyId)
      .folder('transaction')
      .file(fileName),
    fileName,
    txidHash
  }
}

/**
 * Changes a wallet's name.
 */
export function renameCurrencyWallet(
  input: CurrencyWalletInput,
  name: string | null
): Promise<void> {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  return getStorageWalletFolder(state, walletId)
    .file(WALLET_NAME_FILE)
    .setText(JSON.stringify({ walletName: name }))
    .then(() => {
      dispatch({
        type: 'CURRENCY_WALLET_NAME_CHANGED',
        payload: { name, walletId }
      })
    })
}

/**
 * Changes a wallet's fiat currency code.
 */
export function setCurrencyWalletFiat(
  input: CurrencyWalletInput,
  fiatCurrencyCode: string
): Promise<void> {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  if (!/^iso:/.test(fiatCurrencyCode)) {
    throw new TypeError('Fiat currency codes must start with `iso:`')
  }

  return getStorageWalletFolder(state, walletId)
    .file(CURRENCY_FILE)
    .setText(JSON.stringify({ fiat: fiatCurrencyCode }))
    .then(() => {
      dispatch({
        type: 'CURRENCY_WALLET_FIAT_CHANGED',
        payload: { fiatCurrencyCode, walletId }
      })
    })
}

/**
 * Loads the wallet fiat currency file.
 */
function loadFiatFile(
  input: CurrencyWalletInput,
  folder: DiskletFolder
): Promise<void> {
  const walletId = input.props.id
  const { dispatch } = input.props

  return folder
    .file(CURRENCY_FILE)
    .getText()
    .then(text => {
      const file = JSON.parse(text)
      return file.fiat
        ? file.fiat
        : 'iso:' + currencyFromNumber(('000' + file.num).slice(-3)).code
    })
    .catch(e => 'iso:USD')
    .then((fiatCurrencyCode: string) => {
      dispatch({
        type: 'CURRENCY_WALLET_FIAT_CHANGED',
        payload: { fiatCurrencyCode, walletId }
      })
    })
}

/**
 * Loads the wallet name file.
 */
function loadNameFile(
  input: CurrencyWalletInput,
  folder: DiskletFolder
): Promise<void> {
  const walletId = input.props.id
  const { dispatch } = input.props

  return folder
    .file(WALLET_NAME_FILE)
    .getText()
    .then(text => JSON.parse(text).walletName)
    .catch(async e => {
      // The wallet info does happen to have full data, so this works:
      const fullWalletInfo: any = input.props.selfState.walletInfo
      const name = await fetchBackupName(input, fullWalletInfo.appIds || [])
      if (name != null) await renameCurrencyWallet(input, name)
      return name
    })
    .then((name: string | null) => {
      dispatch({
        type: 'CURRENCY_WALLET_NAME_CHANGED',
        payload: {
          name: typeof name === 'string' ? name : null,
          walletId
        }
      })
    })
}

/**
 * If a wallet has no name file, try to pick a name based on the appId.
 */
function fetchBackupName(
  input: CurrencyWalletInput,
  appIds: string[]
): Promise<string | null> {
  const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
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
export async function loadTxFiles(
  input: CurrencyWalletInput,
  txIdHashes: string[]
): Promise<{ [txidHash: string]: any }> {
  const walletId = input.props.id
  const folder = getStorageWalletFolder(input.props.state, walletId)
  const { dispatch } = input.props
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const fileNames = input.props.selfState.fileNames
  const walletFiat = input.props.selfState.fiat

  const getFiles = (folderName, cb) =>
    Promise.all(
      txIdHashes.map(txidHash =>
        folder
          .folder(folderName)
          .file(fileNames[txidHash].fileName)
          .getText()
          .then(text => cb(JSON.parse(text), txidHash))
          .catch(e => null)
      )
    )

  const out = {}
  await getFiles('Transactions', (json, txidHash) => {
    if (!json.state || !json.state.malleableTxId) return
    out[txidHash] = fixLegacyFile(json, walletCurrency, walletFiat)
  })
  await getFiles('transaction', (json, txidHash) => {
    if (!json.txid) return
    out[txidHash] = json
  })

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
async function getLegacyFileNames(
  state: RootState,
  walletId: string,
  folder: DiskletFolder
): Promise<TxFileNames> {
  const newFormatFileNames: TxFileNames = {}
  // Get the non encrypted folder
  const localFolder = getStorageWalletLocalFolder(state, walletId)
  const fixedNamesFile = localFolder.file(LEGACY_MAP_FILE)
  const legacyFileNames: string[] = []
  let legacyMap: LegacyMapFile = {}
  try {
    // Get the real legacy file names
    await mapFiles(folder, (file, name) => legacyFileNames.push(name))
  } catch (e) {}
  try {
    const text = await fixedNamesFile.getText()
    legacyMap = JSON.parse(text)
  } catch (e) {}

  const missingLegacyFiles = []
  for (let i = 0; i < legacyFileNames.length; i++) {
    const fileName = legacyFileNames[i]
    const fileNameMap = legacyMap[fileName]
    // If we haven't converted it, then open the legacy file and convert it to the new format
    if (fileNameMap) {
      const { timestamp, txidHash } = fileNameMap
      newFormatFileNames[txidHash] = { creationDate: timestamp, fileName }
    } else {
      missingLegacyFiles.push(fileName)
    }
  }
  const convertFileNames = missingLegacyFiles.map(legacyFileName =>
    folder
      .file(legacyFileName)
      .getText()
      .then(txText => {
        const legacyFile = JSON.parse(txText)
        const { creationDate, malleableTxId } = legacyFile.state
        const fileName = legacyFileName
        const txidHash = hashStorageWalletFilename(
          state,
          walletId,
          malleableTxId
        )
        newFormatFileNames[txidHash] = { creationDate, fileName }
        legacyMap[fileName] = { timestamp: creationDate, txidHash }
      })
      .catch(e => null)
  )

  if (convertFileNames.length) {
    await Promise.all(convertFileNames)
    // Cache the new results
    try {
      await fixedNamesFile.setText(JSON.stringify(legacyMap))
    } catch (e) {}
  }
  return newFormatFileNames
}

/**
 * Loads transaction metadata file names.
 */
async function loadTxFileNames(
  input: CurrencyWalletInput,
  folder: DiskletFolder
): Promise<void> {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  // Legacy transactions files:
  const txFileNames: TxFileNames = await getLegacyFileNames(
    state,
    walletId,
    folder.folder('Transactions')
  )

  // New transactions files:
  await mapFiles(folder.folder('transaction'), (file, fileName) => {
    const prefix = fileName.split('.json')[0]
    const split: string[] = prefix.split('-')
    const [creationDate, txidHash] = split
    txFileNames[txidHash] = { creationDate: parseInt(creationDate), fileName }
  })

  dispatch({
    type: 'CURRENCY_WALLET_FILE_NAMES_LOADED',
    payload: { txFileNames, walletId }
  })
}

/**
 * Loads address metadata files.
 */
function loadAddressFiles(
  input: CurrencyWalletInput,
  folder: DiskletFolder
): Promise<string[]> {
  // Actually load the files:
  const oldFiles = mapFiles(folder.folder('Addresses'), file =>
    file
      .getText()
      .then(text => JSON.parse(text))
      .catch(e => null)
  )

  // Save the results to our state:
  return oldFiles.then((oldFiles: LegacyAddressFile[]) => {
    const out: string[] = []
    for (const json of oldFiles) {
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
export async function loadAllFiles(input: CurrencyWalletInput): Promise<void> {
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
export function setCurrencyWalletTxMetadata(
  input: CurrencyWalletInput,
  txid: string,
  currencyCode: string,
  metadata: DiskMetadata,
  fakeCallbacks: EdgeCurrencyEngineCallbacks
): Promise<void> {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  // Find the tx:
  const tx = input.props.selfState.txs[txid]
  if (!tx) {
    throw new Error(`Setting metatdata for missing tx ${txid}`)
  }

  const files = input.props.selfState.files
  // Get the txidHash for this txid
  let oldTxidHash = ''
  for (const hash of Object.keys(files)) {
    if (files[hash].txid === txid) {
      oldTxidHash = hash
      break
    }
  }

  // Load the old file:
  const oldFile = input.props.selfState.files[oldTxidHash]
  const creationDate =
    oldFile == null ? Date.now() / 1000 : oldFile.creationDate

  // Set up the new file:
  const { diskletFile, fileName, txidHash } = getTxFile(
    state,
    walletId,
    creationDate,
    txid
  )
  const newFile: TransactionFile = {
    txid,
    internal: false,
    creationDate,
    currencies: {}
  }
  newFile.currencies[currencyCode] = {
    metadata
  }
  const json = mergeDeeply(oldFile, newFile)

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { creationDate, fileName, json, txid, txidHash, walletId }
  })
  return diskletFile.setText(JSON.stringify(json)).then(() => {
    const callbackTx = combineTxWithFile(input, tx, json, currencyCode)
    fakeCallbacks.onTransactionsChanged([callbackTx])
  })
}

/**
 * Sets up metadata for an incoming transaction.
 */
export function setupNewTxMetadata(
  input: CurrencyWalletInput,
  tx: EdgeTransaction
): Promise<void> {
  const { dispatch, selfState, state, id: walletId } = input.props
  const { currencyInfo, fiat = 'iso:USD' } = selfState
  const { currencyCode, spendTargets, swapData, txid } = tx

  const creationDate = Date.now() / 1000

  // Calculate the exchange rate:
  const rate =
    getExchangeRate(state, currencyCode, fiat, () => 1) /
    parseFloat(
      getCurrencyMultiplier(
        [currencyInfo],
        input.props.state.currency.customTokens,
        currencyCode
      )
    )
  const nativeAmount = tx.nativeAmount
  const exchangeAmount = rate * Number(nativeAmount)

  // Set up metadata:
  const metadata: DiskMetadata =
    tx.metadata != null
      ? packMetadata(tx.metadata, fiat)
      : { exchangeAmount: {} }
  metadata.exchangeAmount[fiat] = exchangeAmount

  // Basic file template:
  const json: TransactionFile = {
    txid,
    internal: true,
    creationDate,
    currencies: {},
    swap: swapData
  }
  json.currencies[currencyCode] = { metadata, nativeAmount }

  // Set up payees:
  if (spendTargets != null) {
    json.payees = spendTargets.map(target => ({
      currency: target.currencyCode,
      address: target.publicAddress,
      amount: target.nativeAmount,
      tag: target.uniqueIdentifier
    }))
  }

  // Save the new file:
  const { diskletFile, fileName, txidHash } = getTxFile(
    state,
    walletId,
    creationDate,
    txid
  )
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { creationDate, fileName, json, txid, txidHash, walletId }
  })
  return diskletFile.setText(JSON.stringify(json)).then(() => undefined)
}

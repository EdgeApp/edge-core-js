// @flow

import { number as currencyFromNumber } from 'currency-codes'
import { type Disklet, justFiles, navigateDisklet } from 'disklet'

import {
  type EdgeCurrencyEngineCallbacks,
  type EdgeTransaction
} from '../../../types/types.js'
import { makeJsonFile } from '../../../util/file-helpers.js'
import { mergeDeeply } from '../../../util/util.js'
import { fetchAppIdInfo } from '../../account/lobby-api.js'
import { getExchangeRate } from '../../exchange/exchange-selectors.js'
import { type ApiInput } from '../../root-pixie.js'
import { type RootState } from '../../root-reducer.js'
import {
  getStorageWalletDisklet,
  getStorageWalletLocalDisklet,
  hashStorageWalletFilename
} from '../../storage/storage-selectors.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import { combineTxWithFile } from './currency-wallet-api.js'
import {
  type DiskMetadata,
  type LegacyTransactionFile,
  type TransactionFile,
  asLegacyAddressFile,
  asLegacyMapFile,
  asLegacyTransactionFile,
  asTransactionFile,
  asWalletFiatFile,
  asWalletNameFile,
  packMetadata
} from './currency-wallet-cleaners.js'
import { type CurrencyWalletInput } from './currency-wallet-pixie.js'
import { type TxFileNames } from './currency-wallet-reducer.js'

const LEGACY_MAP_FILE = 'fixedLegacyFileNames.json'
const WALLET_NAME_FILE = 'WalletName.json'
const CURRENCY_FILE = 'Currency.json'

const legacyAddressFile = makeJsonFile(asLegacyAddressFile)
const legacyMapFile = makeJsonFile(asLegacyMapFile)
const legacyTransactionFile = makeJsonFile(asLegacyTransactionFile)
const transactionFile = makeJsonFile(asTransactionFile)
const walletFiatFile = makeJsonFile(asWalletFiatFile)
const walletNameFile = makeJsonFile(asWalletNameFile)

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

function getTxFileName(
  state: RootState,
  keyId: string,
  creationDate: number,
  txid: string
): { fileName: string, txidHash: string } {
  const txidHash: string = hashStorageWalletFilename(state, keyId, txid)
  return {
    fileName: `${creationDate.toFixed(0)}-${txidHash}.json`,
    txidHash
  }
}

/**
 * Changes a wallet's name.
 */
export async function renameCurrencyWallet(
  input: CurrencyWalletInput,
  name: string | null
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  await walletNameFile.save(disklet, WALLET_NAME_FILE, {
    walletName: name
  })

  dispatch({
    type: 'CURRENCY_WALLET_NAME_CHANGED',
    payload: { name, walletId }
  })
}

/**
 * Changes a wallet's fiat currency code.
 */
export async function setCurrencyWalletFiat(
  input: CurrencyWalletInput,
  fiatCurrencyCode: string
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  if (!/^iso:/.test(fiatCurrencyCode)) {
    throw new TypeError('Fiat currency codes must start with `iso:`')
  }

  await walletFiatFile.save(disklet, CURRENCY_FILE, {
    fiat: fiatCurrencyCode,
    num: undefined
  })

  dispatch({
    type: 'CURRENCY_WALLET_FIAT_CHANGED',
    payload: { fiatCurrencyCode, walletId }
  })
}

/**
 * Loads the wallet fiat currency file.
 */
async function loadFiatFile(input: CurrencyWalletInput): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const clean = await walletFiatFile.load(disklet, CURRENCY_FILE)
  let fiatCurrencyCode = 'iso:USD'
  if (clean != null) {
    if (clean.fiat != null) {
      fiatCurrencyCode = clean.fiat
    } else if (clean.num != null) {
      fiatCurrencyCode = `iso:${
        currencyFromNumber(`000${clean.num}`.slice(-3)).code
      }`
    }
  }

  dispatch({
    type: 'CURRENCY_WALLET_FIAT_CHANGED',
    payload: { fiatCurrencyCode, walletId }
  })
}

/**
 * Loads the wallet name file.
 */
async function loadNameFile(input: CurrencyWalletInput): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const clean = await walletNameFile.load(disklet, WALLET_NAME_FILE)
  let name: string | null = null
  if (clean == null || clean.walletName == null) {
    // If a wallet has no name file, try to pick a name based on the appId:
    const ai: ApiInput = (input: any) // Safe, since input extends ApiInput
    const { appIds = [] } = input.props.walletState.walletInfo

    const appId = appIds.find(appId => appId !== '')
    if (appId != null) {
      const { displayName } = await fetchAppIdInfo(ai, appId)
      name = displayName
    }
  } else {
    name = clean.walletName
  }

  dispatch({
    type: 'CURRENCY_WALLET_NAME_CHANGED',
    payload: {
      name: typeof name === 'string' ? name : null,
      walletId
    }
  })
}

/**
 * Loads transaction metadata files.
 */
export async function loadTxFiles(
  input: CurrencyWalletInput,
  txIdHashes: string[]
): Promise<{ [txidHash: string]: TransactionFile }> {
  const { walletId } = input.props
  const disklet = getStorageWalletDisklet(input.props.state, walletId)
  const { dispatch } = input.props
  const walletCurrency = input.props.walletState.currencyInfo.currencyCode
  const fileNames = input.props.walletState.fileNames
  const walletFiat = input.props.walletState.fiat

  const out: { [filename: string]: TransactionFile } = {}
  await Promise.all(
    txIdHashes.map(async txidHash => {
      if (fileNames[txidHash] == null) return
      const path = `Transactions/${fileNames[txidHash].fileName}`
      const clean = await legacyTransactionFile.load(disklet, path)
      if (clean == null) return
      out[txidHash] = fixLegacyFile(clean, walletCurrency, walletFiat)
    })
  )
  await Promise.all(
    txIdHashes.map(async txidHash => {
      if (fileNames[txidHash] == null) return
      const path = `transaction/${fileNames[txidHash].fileName}`
      const clean = await transactionFile.load(disklet, path)
      if (clean == null) return
      out[txidHash] = clean
    })
  )

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
  disklet: Disklet
): Promise<TxFileNames> {
  // Load the cache, if it exists:
  const localDisklet = getStorageWalletLocalDisklet(state, walletId)
  const legacyMap =
    (await legacyMapFile.load(localDisklet, LEGACY_MAP_FILE)) ?? {}

  // Get the real legacy file names:
  const legacyFileNames = justFiles(await disklet.list())

  const newFormatFileNames: TxFileNames = {}
  const missingLegacyFiles: string[] = []
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
  const convertFileNames = missingLegacyFiles.map(async legacyFileName => {
    const clean = await legacyTransactionFile.load(disklet, legacyFileName)
    if (clean == null) return
    const { creationDate, malleableTxId } = clean.state
    const fileName = legacyFileName
    const txidHash = hashStorageWalletFilename(state, walletId, malleableTxId)
    newFormatFileNames[txidHash] = { creationDate, fileName }
    legacyMap[fileName] = { timestamp: creationDate, txidHash }
  })

  if (convertFileNames.length) {
    await Promise.all(convertFileNames)
    // Cache the new results
    await legacyMapFile
      .save(localDisklet, LEGACY_MAP_FILE, legacyMap)
      .catch(() => {})
  }
  return newFormatFileNames
}

/**
 * Loads transaction metadata file names.
 */
async function loadTxFileNames(input: CurrencyWalletInput): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  // Legacy transactions files:
  const txFileNames: TxFileNames = await getLegacyFileNames(
    state,
    walletId,
    navigateDisklet(disklet, 'Transactions')
  )

  // New transactions files:
  const listing = await navigateDisklet(disklet, 'transaction').list()
  for (const fileName of justFiles(listing)) {
    const prefix = fileName.split('.json')[0]
    const split: string[] = prefix.split('-')
    const [creationDatePart, txidHash] = split
    const creationDate = parseInt(creationDatePart)

    // Create entry in the txFileNames for the txidHash if it doesn't exist
    // or the creation date is older than the existing one
    if (
      txFileNames[txidHash] == null ||
      creationDate < txFileNames[txidHash].creationDate
    ) {
      txFileNames[txidHash] = { creationDate, fileName }
    }
  }

  dispatch({
    type: 'CURRENCY_WALLET_FILE_NAMES_LOADED',
    payload: { txFileNames, walletId }
  })
}

/**
 * Loads address metadata files.
 */
async function loadAddressFiles(input: CurrencyWalletInput): Promise<void> {
  const { state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  // Save the results to our state:
  const out: string[] = []
  const paths = justFiles(await disklet.list('Addresses'))
  await Promise.all(
    paths.map(async path => {
      const clean = await legacyAddressFile.load(disklet, path)
      if (clean == null) return
      if (clean.address === '' || clean.state.recycleable) return
      out.push(clean.address)
    })
  )

  // Load these addresses into the engine:
  const engine = input.props.walletOutput.engine
  if (engine != null) await engine.addGapLimitAddresses(out)
}

/**
 * Updates the wallet in response to data syncs.
 */
export async function loadAllFiles(input: CurrencyWalletInput): Promise<void> {
  await loadFiatFile(input)
  await loadNameFile(input)
  await loadTxFileNames(input)
  await loadAddressFiles(input)
}

/**
 * Changes a wallet's metadata.
 */
export async function setCurrencyWalletTxMetadata(
  input: CurrencyWalletInput,
  txid: string,
  currencyCode: string,
  metadata: DiskMetadata,
  fakeCallbacks: EdgeCurrencyEngineCallbacks
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  // Find the tx:
  const tx = input.props.walletState.txs[txid]
  if (!tx) {
    throw new Error(`Setting metatdata for missing tx ${txid}`)
  }

  const files = input.props.walletState.files
  // Get the txidHash for this txid
  let oldTxidHash = ''
  for (const hash of Object.keys(files)) {
    if (files[hash].txid === txid) {
      oldTxidHash = hash
      break
    }
  }

  // Load the old file:
  const oldFile = input.props.walletState.files[oldTxidHash]
  const creationDate =
    oldFile == null ? Date.now() / 1000 : oldFile.creationDate

  // Set up the new file:
  const { fileName, txidHash } = getTxFileName(
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
  await transactionFile.save(disklet, 'transaction/' + fileName, json)
  const callbackTx = combineTxWithFile(input, tx, json, currencyCode)
  fakeCallbacks.onTransactionsChanged([callbackTx])
}

/**
 * Sets up metadata for an incoming transaction.
 */
export async function setupNewTxMetadata(
  input: CurrencyWalletInput,
  tx: EdgeTransaction
): Promise<void> {
  const { dispatch, walletState, state, walletId } = input.props
  const { fiat = 'iso:USD', pluginId } = walletState
  const { currencyCode, spendTargets, swapData, txid } = tx
  const disklet = getStorageWalletDisklet(state, walletId)

  const creationDate = Date.now() / 1000

  // Calculate the exchange rate:
  const rate =
    getExchangeRate(state, currencyCode, fiat, () => 1) /
    parseFloat(
      getCurrencyMultiplier(
        { [pluginId]: input.props.state.plugins.currency[pluginId] },
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

  // Set up the fee metadata:
  if (tx.networkFeeOption != null) {
    json.feeRateRequested =
      tx.networkFeeOption === 'custom'
        ? tx.requestedCustomFee
        : tx.networkFeeOption
  }
  json.feeRateUsed = tx.feeRateUsed

  // Set up payees:
  if (spendTargets != null) {
    json.payees = spendTargets.map(target => ({
      currency: target.currencyCode,
      address: target.publicAddress,
      amount: target.nativeAmount,
      tag: target.memo
    }))

    // Only write device description if it's a spend
    if (tx.deviceDescription != null)
      json.deviceDescription = tx.deviceDescription
  }
  if (typeof tx.txSecret === 'string') json.secret = tx.txSecret

  // Save the new file:
  const { fileName, txidHash } = getTxFileName(
    state,
    walletId,
    creationDate,
    txid
  )
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { creationDate, fileName, json, txid, txidHash, walletId }
  })
  await transactionFile.save(disklet, 'transaction/' + fileName, json)
}

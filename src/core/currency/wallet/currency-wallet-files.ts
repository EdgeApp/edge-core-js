import { number as currencyFromNumber } from 'currency-codes'
import { Disklet, justFiles, navigateDisklet } from 'disklet'

import {
  EdgeAssetAction,
  EdgeCurrencyEngineCallbacks,
  EdgeMetadataChange,
  EdgeTokenId,
  EdgeTransaction,
  EdgeTxAction
} from '../../../types/types'
import { makeJsonFile } from '../../../util/file-helpers'
import { fetchAppIdInfo } from '../../account/lobby-api'
import { toApiInput } from '../../root-pixie'
import { RootState } from '../../root-reducer'
import {
  getStorageWalletDisklet,
  getStorageWalletLocalDisklet,
  hashStorageWalletFilename
} from '../../storage/storage-selectors'
import { combineTxWithFile } from './currency-wallet-api'
import {
  asLegacyAddressFile,
  asLegacyMapFile,
  asLegacyTokensFile,
  asLegacyTransactionFile,
  asSeenCheckpointFile,
  asTokensFile,
  asTransactionFile,
  asWalletFiatFile,
  asWalletNameFile,
  LegacyTransactionFile,
  TransactionAsset,
  TransactionFile
} from './currency-wallet-cleaners'
import { CurrencyWalletInput } from './currency-wallet-pixie'
import { TxFileNames } from './currency-wallet-reducer'
import { currencyCodesToTokenIds } from './enabled-tokens'
import { mergeMetadata } from './metadata'

const CURRENCY_FILE = 'Currency.json'
const LEGACY_MAP_FILE = 'fixedLegacyFileNames.json'
const LEGACY_TOKENS_FILE = 'EnabledTokens.json'
const SEEN_TX_CHECKPOINT_FILE = 'seenTxCheckpoint.json'
const TOKENS_FILE = 'Tokens.json'
const WALLET_NAME_FILE = 'WalletName.json'

const legacyAddressFile = makeJsonFile(asLegacyAddressFile)
const legacyMapFile = makeJsonFile(asLegacyMapFile)
const legacyTokensFile = makeJsonFile(asLegacyTokensFile)
const legacyTransactionFile = makeJsonFile(asLegacyTransactionFile)
const seenCheckpointFile = makeJsonFile(asSeenCheckpointFile)
const tokensFile = makeJsonFile(asTokensFile)
const transactionFile = makeJsonFile(asTransactionFile)
const walletFiatFile = makeJsonFile(asWalletFiatFile)
const walletNameFile = makeJsonFile(asWalletNameFile)

/**
 * Updates the enabled tokens on a wallet.
 */
export async function writeTokensFile(
  input: CurrencyWalletInput,
  detectedTokenIds: string[],
  enabledTokenIds: string[]
): Promise<void> {
  const { state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  await tokensFile.save(disklet, TOKENS_FILE, {
    detectedTokenIds,
    enabledTokenIds
  })
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
    currencies: new Map(),
    tokens: new Map(),
    internal: file.state.internal,
    txid: file.state.malleableTxId
  }
  const exchangeAmount: { [currencyCode: string]: number } = {}
  exchangeAmount[walletFiat] = file.meta.amountCurrency
  out.currencies.set(walletCurrency, {
    metadata: {
      bizId: file.meta.bizId,
      category: file.meta.category,
      exchangeAmount,
      name: file.meta.name,
      notes: file.meta.notes
    },
    providerFeeSent: file.meta.amountFeeAirBitzSatoshi.toFixed()
  })

  return out
}

function deriveFileNameFields(
  state: RootState,
  walletId: string,
  txid: string,
  txDate: number
): { creationDate: number; fileName: string; txidHash: string } {
  const fileNames = state.currency.wallets[walletId].fileNames
  const txidHash: string = hashStorageWalletFilename(state, walletId, txid)
  // Set up the new file:
  const { creationDate = Math.min(txDate, Date.now() / 1000) } =
    fileNames[txidHash] ?? {}
  // Should match `fileNames[txidHash].fileName` if `fileNames[txidHash] != null`:
  const fileName = `${creationDate.toFixed(0)}-${txidHash}.json`
  return {
    creationDate,
    fileName,
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
export async function loadFiatFile(input: CurrencyWalletInput): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const clean = await walletFiatFile.load(disklet, CURRENCY_FILE)
  let fiatCurrencyCode = 'iso:USD'
  if (clean != null) {
    if (clean.fiat != null) {
      fiatCurrencyCode = clean.fiat
    } else if (clean.num != null) {
      const code = currencyFromNumber(`000${clean.num}`.slice(-3))
      if (code != null) fiatCurrencyCode = `iso:${code.code}`
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
export async function loadNameFile(input: CurrencyWalletInput): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const clean = await walletNameFile.load(disklet, WALLET_NAME_FILE)
  let name: string | null = null
  if (clean == null || clean.walletName == null) {
    // If a wallet has no name file, try to pick a name based on the appId:
    const { appIds = [] } = input.props.walletState.walletInfo

    const appId = appIds.find(appId => appId !== '')
    if (appId != null) {
      const { appName } = await fetchAppIdInfo(toApiInput(input), appId)
      name = appName
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
 * Load the enabled tokens file, with fallback to the legacy file.
 */
export async function loadTokensFile(
  input: CurrencyWalletInput
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const clean = await tokensFile.load(disklet, TOKENS_FILE)
  if (clean != null) {
    const shortId = walletId.slice(0, 2)
    input.props.log.warn(`enabledTokenIds: ${shortId} loaded modern file`)
    dispatch({
      type: 'CURRENCY_WALLET_LOADED_TOKEN_FILE',
      payload: { walletId: input.props.walletId, ...clean }
    })
    return
  }

  const legacyCurrencyCodes = await legacyTokensFile.load(
    disklet,
    LEGACY_TOKENS_FILE
  )
  if (legacyCurrencyCodes != null) {
    const { accountId, currencyInfo, pluginId } = input.props.walletState
    const accountState = input.props.state.accounts[accountId]
    const tokenIds = currencyCodesToTokenIds(
      accountState.builtinTokens[pluginId],
      accountState.customTokens[pluginId],
      currencyInfo,
      legacyCurrencyCodes
    )

    const shortId = walletId.slice(0, 2)
    input.props.log.warn(`enabledTokenIds: ${shortId} loaded legacy file`)
    dispatch({
      type: 'CURRENCY_WALLET_LOADED_TOKEN_FILE',
      payload: {
        walletId: input.props.walletId,
        detectedTokenIds: [],
        enabledTokenIds: tokenIds
      }
    })
    return
  }

  // Both the new and old files are missing:
  const shortId = walletId.slice(0, 2)
  input.props.log.warn(`enabledTokenIds: ${shortId} loaded neither file`)
  dispatch({
    type: 'CURRENCY_WALLET_LOADED_TOKEN_FILE',
    payload: {
      walletId: input.props.walletId,
      detectedTokenIds: [],
      enabledTokenIds: []
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
  const { dispatch, walletId } = input.props
  const disklet = getStorageWalletDisklet(input.props.state, walletId)
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
    if (fileNameMap != null) {
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

  if (convertFileNames.length > 0) {
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
export async function loadTxFileNames(
  input: CurrencyWalletInput
): Promise<void> {
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
export async function loadAddressFiles(
  input: CurrencyWalletInput
): Promise<void> {
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
  const engine = input.props.walletOutput?.engine
  if (engine != null) await engine.addGapLimitAddresses(out)
}

/**
 * Changes a wallet's metadata.
 */
export async function updateCurrencyWalletTxMetadata(
  input: CurrencyWalletInput,
  txid: string,
  tokenId: EdgeTokenId,
  fakeCallbacks: EdgeCurrencyEngineCallbacks,
  metadataChange?: EdgeMetadataChange,
  assetAction?: EdgeAssetAction,
  savedAction?: EdgeTxAction
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  // Find the currency code:
  const { accountId, currencyInfo, pluginId } = input.props.walletState
  const allTokens = input.props.state.accounts[accountId].allTokens[pluginId]
  const { currencyCode } = tokenId == null ? currencyInfo : allTokens[tokenId]

  // Find the tx:
  const tx = input.props.walletState.txs[txid]
  if (tx == null) {
    throw new Error(`Setting metatdata for missing tx ${txid}`)
  }

  // Derive the file name:
  const { creationDate, fileName, txidHash } = deriveFileNameFields(
    state,
    walletId,
    tx.txid,
    tx.date
  )

  // Get the old file data if it exists:
  const oldFile = await transactionFile.load(disklet, `transaction/${fileName}`)

  // Merge with old file
  const newFile: TransactionFile = {
    ...oldFile,
    creationDate,
    currencies: new Map(oldFile?.currencies ?? []),
    internal: true,
    tokens: new Map(oldFile?.tokens ?? []),
    txid
  }

  // Migrate the asset data from currencyCode to tokenId:
  const assetData: TransactionAsset = {
    metadata: {},
    ...newFile.currencies.get(currencyCode),
    ...newFile.tokens.get(tokenId)
  }
  newFile.tokens.set(tokenId, assetData)
  newFile.currencies.delete(currencyCode)

  // Make the change:
  if (metadataChange != null) {
    assetData.metadata = mergeMetadata(assetData.metadata ?? {}, metadataChange)
  }
  if (assetAction != null) assetData.assetAction = assetAction
  if (savedAction != null) newFile.savedAction = savedAction

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: { creationDate, fileName, json: newFile, txid, txidHash, walletId }
  })
  await transactionFile.save(disklet, 'transaction/' + fileName, newFile)
  const callbackTx = combineTxWithFile(input, tx, newFile, tokenId)
  fakeCallbacks.onTransactions([
    // This method is used to update metadata for existing/seen transactions,
    // so we should always mark the transaction as not new.
    { isNew: false, transaction: callbackTx }
  ])
}

/**
 * Sets up metadata for a transaction in-memory without persisting the
 * metadata to disk.
 */
export async function setupNewTxMetadata(
  input: CurrencyWalletInput,
  tx: EdgeTransaction
): Promise<{ txFile: TransactionFile; fileName: string }> {
  const { dispatch, state, walletId } = input.props

  const { creationDate, fileName, txidHash } = deriveFileNameFields(
    state,
    walletId,
    tx.txid,
    tx.date
  )

  // Basic file template:
  const txFile: TransactionFile = {
    txid: tx.txid,
    internal: true,
    creationDate,
    currencies: new Map(),
    feeRateUsed: tx.feeRateUsed,
    tokens: new Map(),
    savedAction: tx.savedAction,
    swap: tx.swapData
  }
  txFile.tokens.set(tx.tokenId, {
    assetAction: tx.assetAction,
    metadata: tx.metadata ?? {},
    nativeAmount: tx.nativeAmount
  })

  // Set up the fee metadata:
  if (tx.networkFeeOption != null) {
    txFile.feeRateRequested =
      tx.networkFeeOption === 'custom'
        ? tx.requestedCustomFee
        : tx.networkFeeOption
  }

  // Set up payees:
  if (tx.spendTargets != null) {
    txFile.payees = tx.spendTargets.map(target => ({
      currency: target.currencyCode,
      address: target.publicAddress,
      amount: target.nativeAmount,
      tag: target.memo
    }))

    // Only write device description if it's a spend
    if (tx.deviceDescription != null)
      txFile.deviceDescription = tx.deviceDescription
  }
  if (typeof tx.txSecret === 'string') txFile.secret = tx.txSecret

  // Save the new file:
  dispatch({
    type: 'CURRENCY_WALLET_FILE_CHANGED',
    payload: {
      creationDate,
      fileName,
      json: txFile,
      txid: tx.txid,
      txidHash,
      walletId
    }
  })

  return { fileName, txFile }
}

/**
 * Persists metadata for a transaction to disk.
 */
export async function saveTxMetadataFile(
  input: CurrencyWalletInput,
  fileName: string,
  txFile: TransactionFile
): Promise<void> {
  const { state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)
  await transactionFile.save(disklet, 'transaction/' + fileName, txFile)
}

/**
 * Loads the seen transaction checkpoint file for a specific wallet.
 */
export async function loadSeenTxCheckpointFile(
  input: CurrencyWalletInput
): Promise<string | undefined> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)
  const { checkpoint } =
    (await seenCheckpointFile.load(disklet, SEEN_TX_CHECKPOINT_FILE)) ?? {}
  if (checkpoint != null) {
    dispatch({
      type: 'CURRENCY_ENGINE_SEEN_TX_CHECKPOINT_CHANGED',
      payload: { checkpoint, walletId }
    })
  }
  return checkpoint
}

/**
 * Save's the seen transaction checkpoint file for a specific wallet.
 */
export async function saveSeenTxCheckpointFile(
  input: CurrencyWalletInput,
  checkpoint: string
): Promise<void> {
  const { dispatch, state, walletId } = input.props
  const disklet = getStorageWalletDisklet(state, walletId)

  const fileData = {
    checkpoint
  }

  dispatch({
    type: 'CURRENCY_ENGINE_SEEN_TX_CHECKPOINT_CHANGED',
    payload: { checkpoint, walletId }
  })

  await seenCheckpointFile.save(disklet, SEEN_TX_CHECKPOINT_FILE, fileData)
}

export async function reloadWalletFiles(
  input: CurrencyWalletInput,
  changes: string[]
): Promise<void> {
  if (changes.includes(TOKENS_FILE) || changes.includes(LEGACY_TOKENS_FILE)) {
    await loadTokensFile(input)
  }
  if (changes.includes(CURRENCY_FILE)) {
    await loadFiatFile(input)
  }
  if (changes.includes(WALLET_NAME_FILE)) {
    await loadNameFile(input)
  }
  await loadTxFileNames(input)
  await loadAddressFiles(input)
}

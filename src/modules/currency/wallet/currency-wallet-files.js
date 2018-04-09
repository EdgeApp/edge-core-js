// @flow

import { number as currencyFromNumber } from 'currency-codes'
import { mapFiles } from 'disklet'

import { fetchAppIdInfo } from '../../account/lobbyApi.js'
import { getStorageWalletFolder } from '../../storage/selectors.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'
import {
  loadMetadataFile,
  loadTxFiles,
  saveFilesMetadata,
  setCurrencyWalletTxMetadata,
  setupNewTxMetadata
} from './currency-wallet-tx-files.js'
import type { TransactionFile } from './currency-wallet-tx-files.js'

const WALLET_NAME_FILE = 'WalletName.json'
const CURRENCY_FILE = 'Currency.json'

export type LegacyAddressFile = {
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
 * Changes a wallet's name.
 */
export function renameCurrencyWallet (
  input: CurrencyWalletInput,
  name: string | null
) {
  const walletId = input.props.id
  const { dispatch, state } = input.props

  return getStorageWalletFolder(state, walletId)
    .file(WALLET_NAME_FILE)
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
    .file(CURRENCY_FILE)
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
    .file(CURRENCY_FILE)
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
  await loadMetadataFile(input, folder)
  await loadAddressFiles(input, folder)
}

export {
  setupNewTxMetadata,
  loadTxFiles,
  setCurrencyWalletTxMetadata,
  saveFilesMetadata
}
export type { TransactionFile }

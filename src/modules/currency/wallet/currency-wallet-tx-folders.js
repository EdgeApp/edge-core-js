// @flow
import { hashStorageWalletFilename } from '../../storage/selectors.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'
import type { TransactionFile } from './currency-wallet-tx-files.js'

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

export const TxFolders = {
  // Version 1 (Airbitz) files
  V1: {
    folder: 'Transactions',
    loader: (json: LegacyTransactionFile, input: CurrencyWalletInput) => {
      const walletCurrency = input.props.selfState.currencyInfo.currencyCode
      const walletFiat = input.props.selfState.fiat
      if (!json.state || !json.state.malleableTxId) return
      return fixLegacyFile(json, walletCurrency, walletFiat)
    },
    converter: async (
      missingLegacyFiles: Array<string>,
      state: any,
      walletId: string,
      folder: any
    ) => {
      const filesMetadata = {}
      const convertFilesToMetadata = missingLegacyFiles.map(legacyFileName =>
        folder
          .file(legacyFileName)
          .getText()
          .then(txText => {
            const legacyFile = JSON.parse(txText)
            const { creationDate, malleableTxId } = legacyFile.state
            filesMetadata[legacyFileName] = {
              version: 'V1',
              creationDate: parseInt(creationDate),
              txidHash: hashStorageWalletFilename(
                state,
                walletId,
                malleableTxId
              ),
              dropped: false,
              token: false
            }
          })
          .catch(e => null)
      )
      await Promise.all(convertFilesToMetadata)
      return filesMetadata
    }
  },
  // Version 2 (Edge) files
  V2: {
    folder: 'transaction',
    loader: (json: TransactionFile, input: CurrencyWalletInput) => {
      if (!json.txid) return
      return json
    },
    converter: (missingNewFiles: Array<string>) => {
      const filesMetadata = {}
      // Add the missing new file names to the cache object
      for (const fileName of missingNewFiles) {
        const prefix = fileName.split('.json')[0].split('-')
        filesMetadata[fileName] = {
          version: 'V2',
          txidHash: prefix[1],
          dropped: false,
          token: false,
          creationDate: parseInt(prefix[0])
        }
      }
      return filesMetadata
    }
  }
}

export const CurrentVersion = 'V2'

export const isNewerVersion = (next: string, prev?: string) => {
  return !prev || parseInt(next.slice(1)) > parseInt(prev.slice(1))
}

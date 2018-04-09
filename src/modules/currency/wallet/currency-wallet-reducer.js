// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type {
  EdgeCurrencyInfo,
  EdgeWalletInfo
} from '../../../edge-core-index.js'
import type { RootAction } from '../../actions.js'
import type { RootState } from '../../root-reducer.js'
import { getCurrencyInfo } from '../currency-selectors.js'
import type {
  FileName,
  TxFileMetadata,
  TxFilesMetadata,
  TxidHash
} from './currency-wallet-tx-files.js'
import { isNewerVersion } from './currency-wallet-tx-folders.js'

export type TxidHashes = {
  [txidHash: TxidHash]: {
    ...TxFileMetadata,
    fileName: FileName
  }
}

export type SortedTransactions = {
  sortedTxidHashes: Array<TxidHash>,
  txidHashes: TxidHashes
}

export interface CurrencyWalletState {
  currencyInfo: EdgeCurrencyInfo;
  engineFailure: Error | null;
  progressRatio: number;
  fiat: string;
  fiatLoaded: boolean;
  files: { [txidHash: string]: Object };
  filesMetadata: {
    metadata: TxFilesMetadata,
    sortedTransactions: SortedTransactions
  };
  filesMetadataLoaded: boolean;
  filesMetadataChanged: boolean;
  name: string | null;
  nameLoaded: boolean;
  walletInfo: EdgeWalletInfo;
  txids: Array<string>;
  txs: { [txid: string]: Object };
}

export interface CurrencyWalletNext {
  id: string;
  root: RootState;
  +self: CurrencyWalletState;
}

const DefaultFilesMetadata = {
  sortedTransactions: {
    sortedTxidHashes: [],
    txidHashes: {}
  },
  metadata: {}
}

const currencyWalletReducer = buildReducer({
  currencyInfo (state, action, next: CurrencyWalletNext): EdgeCurrencyInfo {
    if (state) return state
    return getCurrencyInfo(next.root.currency.infos, next.self.walletInfo.type)
  },

  engineFailure (state = null, action: RootAction) {
    return action.type === 'CURRENCY_ENGINE_FAILED' ? action.payload : state
  },

  progressRatio (state = 0, action: RootAction) {
    return action.type === 'CURRENCY_ENGINE_PROGGRESS_RATIO'
      ? action.payload.ratio
      : state
  },

  fiat (state = '', action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED'
      ? action.payload.fiatCurrencyCode
      : state
  },

  fiatLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED' ? true : state
  },

  files (state = {}, action: RootAction) {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { file, filesMetadata } = action.payload
        const out = { ...state }
        for (const fileName in filesMetadata) {
          const { txidHash } = filesMetadata[fileName]
          out[txidHash] = file
        }
        return out
      }
      case 'CURRENCY_WALLET_FILES_LOADED': {
        const { files } = action.payload
        return {
          ...state,
          ...files
        }
      }
    }
    return state
  },

  filesMetadata (state = DefaultFilesMetadata, action: RootAction) {
    const mergeMetadata = action => {
      const { filesMetadata } = action.payload
      if (!Object.keys(filesMetadata).length) return state
      const { sortedTransactions, metadata } = state
      const { txidHashes } = sortedTransactions
      return {
        sortedTransactions: sortTxs(txidHashes, filesMetadata),
        metadata: { ...metadata, ...filesMetadata }
      }
    }

    switch (action.type) {
      case 'CURRENCY_WALLET_FILES_METADATA_LOADED': {
        return mergeMetadata(action)
      }
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        return mergeMetadata(action)
      }
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        return mergeMetadata(action)
      }
    }
    return state
  },

  filesMetadataChanged (
    state = false,
    action: RootAction,
    next: CurrencyWalletNext,
    prev: CurrencyWalletNext
  ) {
    if (prev && prev.self) {
      return (
        next.self.filesMetadata.metadata !== prev.self.filesMetadata.metadata
      )
    }
    return state
  },

  filesMetadataLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FILES_METADATA_LOADED'
      ? true
      : state
  },

  name (state = null, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED'
      ? action.payload.name
      : state
  },

  nameLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED' ? true : state
  },

  txids: memoizeReducer(
    (next: CurrencyWalletNext) => next.self.txs,
    txs => Object.keys(txs)
  ),

  txs (state = {}, action: RootAction, next: CurrencyWalletNext) {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        const { txs } = action.payload
        const defaultCurrency = next.self.currencyInfo.currencyCode
        const out = { ...state }
        for (const tx of txs) {
          out[tx.txid] = mergeTx(tx, defaultCurrency, out[tx.txid])
        }
        return out
      }
      case 'CURRENCY_ENGINE_CLEARED':
        return {}
    }

    return state
  },

  walletInfo (state, action, next: CurrencyWalletNext) {
    return next.root.login.walletInfos[next.id]
  }
})

export function sortTxs (
  oldTxidHashes: TxidHashes,
  filesMetadata: TxFilesMetadata
): SortedTransactions {
  const txidHashes = { ...oldTxidHashes }

  for (const fileName in filesMetadata) {
    const newData = filesMetadata[fileName]
    const { dropped, creationDate, version, txidHash } = newData
    const oldData = txidHashes[txidHash]
    if (dropped) {
      delete txidHashes[txidHash]
    } else if (
      !oldData ||
      creationDate < oldData.creationDate ||
      isNewerVersion(version, oldData.version)
    ) {
      txidHashes[txidHash] = { fileName, ...newData }
    }
  }

  const sortedTxidHashes = Object.keys(txidHashes).sort(
    (txidHash1, txidHash2) => {
      if (txidHashes[txidHash1] > txidHashes[txidHash2]) return -1
      if (txidHashes[txidHash1] < txidHashes[txidHash2]) return 1
      return 0
    }
  )

  return { sortedTxidHashes, txidHashes }
}

export default filterReducer(
  currencyWalletReducer,
  (action: RootAction, next: CurrencyWalletNext) => {
    return /^CURRENCY_/.test(action.type) && action.payload.walletId === next.id
      ? action
      : { type: 'UPDATE_PROPS' }
  }
)

/**
 * Merges a new incoming transaction with an existing transaction.
 */
export function mergeTx (tx: any, defaultCurrency: string, oldTx: any = {}) {
  const out = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,

    nativeAmount: { ...oldTx.nativeAmount },
    networkFee: { ...oldTx.networkFee },
    providerFee: { ...oldTx.providerFee }
  }

  const currencyCode =
    tx.currencyCode != null ? tx.currencyCode : defaultCurrency
  out.nativeAmount[currencyCode] =
    tx.amountSatoshi != null ? tx.amountSatoshi.toString() : tx.nativeAmount
  out.networkFee[currencyCode] =
    tx.networkFee != null ? tx.networkFee.toString() : '0'
  out.providerFee[currencyCode] =
    tx.providerFee != null ? tx.providerFee.toString() : '0'

  return out
}

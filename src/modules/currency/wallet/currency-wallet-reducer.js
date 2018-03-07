// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type {
  EdgeCurrencyInfo,
  EdgeWalletInfo
} from '../../../edge-core-index.js'
import { recycle } from '../../../util/compare.js'
import type { RootAction } from '../../actions.js'
import type { RootState } from '../../root-reducer.js'
import { getCurrencyInfo } from '../currency-selectors.js'

export type TxIdHash = {
  txidHash: string,
  timestamp: number
}

export type SortedTransactionList = Array<TxIdHash>

export interface CurrencyWalletState {
  currencyInfo: EdgeCurrencyInfo;
  engineFailure: Error | null;
  fiat: string;
  fiatLoaded: boolean;
  files: { [txid: string]: Object };
  filesLoaded: boolean;
  fileNames: { [txidHash: string]: number };
  fileNamesLoaded: boolean;
  sortedTransactions: SortedTransactionList;
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

const currencyWalletReducer = buildReducer({
  currencyInfo (state, action, next: CurrencyWalletNext): EdgeCurrencyInfo {
    if (state) return state
    return getCurrencyInfo(next.root.currency.infos, next.self.walletInfo.type)
  },

  engineFailure (state = null, action: RootAction) {
    return action.type === 'CURRENCY_ENGINE_FAILED' ? action.payload : state
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
        const { txid, json } = action.payload
        const out = { ...state }
        out[txid] = json
        return out
      }
      case 'CURRENCY_WALLET_FILES_LOADED': {
        const { files } = action.payload
        return recycle(files, state)
      }
    }
    return state
  },

  filesLoaded (state = false, action) {
    return action.type === 'CURRENCY_WALLET_FILES_LOADED' ? true : state
  },

  sortedTransactions (state = [], action: RootAction, next: CurrencyWalletNext) {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        return sortTxs(state, action.payload.txidHashes)
      }
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { fileNames } = action.payload
        const txidHashes = Object.keys(fileNames).map(txidHash => ({
          txidHash,
          timestamp: fileNames[txidHash]
        }))
        return sortTxs(state, txidHashes)
      }
    }
    return state
  },

  fileNames (state = {}, action: RootAction) {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { fileNames } = action.payload
        return {
          ...state,
          ...fileNames
        }
      }
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { txidHash, json } = action.payload
        if (!state[txidHash] || state[txidHash] < json.creationDate) {
          state[txidHash] = json.creationDate
        }
        return state
      }
    }
    return state
  },

  fileNamesLoaded (state = false, action) {
    return action.type === 'CURRENCY_WALLET_FILE_NAMES_LOADED' ? true : state
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
  listA: SortedTransactionList,
  listB: SortedTransactionList
) {
  const sort = (tx1, tx2) => tx2.timestamp - tx1.timestamp
  listA.sort(sort)
  listB.sort(sort)
  let i = 0
  let j = 0
  const listLenA = listA.length
  const listLenB = listB.length
  const sortedList = []
  while (i < listLenA || j < listLenB) {
    let tx = {}
    const txA = i < listLenA && listA[i]
    const txB = j < listLenB && listB[j]
    const timestampA = txA ? txA.timestamp : 0
    const timestampB = txB ? txB.timestamp : 0
    if (!txA) {
      tx = txB
      j++
    } else if (!txB) {
      tx = txA
      i++
    } else if (txA.txidHash === txB.txidHash) {
      tx = timestampA > timestampB ? txA : txB
      i++
      j++
    } else if (timestampA > timestampB) {
      i++
      tx = txA
    } else {
      j++
      tx = txB
    }

    sortedList.push(tx)
  }
  return sortedList
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

// @flow

import {
  type FatReducer,
  buildReducer,
  filterReducer,
  memoizeReducer
} from 'redux-keto'

import {
  type EdgeBalances,
  type EdgeCurrencyInfo,
  type EdgeStakingStatus,
  type EdgeTransaction,
  type EdgeWalletInfo,
  type EdgeWalletInfoFull,
  type JsonObject
} from '../../../types/types.js'
import { compare } from '../../../util/compare.js'
import { type RootAction } from '../../actions.js'
import { findCurrencyPluginId } from '../../plugins/plugins-selectors.js'
import { type RootState } from '../../root-reducer.js'
import { type TransactionFile } from './currency-wallet-cleaners.js'
import { currencyCodesToTokenIds } from './enabled-tokens.js'

/** Maps from txid hash to file creation date & path. */
export type TxFileNames = {
  [txidHash: string]: {
    creationDate: number,
    fileName: string
  }
}

/** Maps from txid hash to file contents (in JSON). */
export type TxFileJsons = { [txidHash: string]: TransactionFile }

/** Maps from txid hash to creation date. */
export type TxidHashes = { [txidHash: string]: number }

export type SortedTransactions = {
  sortedList: string[],
  txidHashes: TxidHashes
}

export type MergedTransaction = {
  confirmations: $PropertyType<EdgeTransaction, 'confirmations'>,
  currencyCode: string,
  blockHeight: number,
  date: number,
  ourReceiveAddresses: string[],
  signedTx: string,
  txid: string,
  otherParams?: JsonObject,

  nativeAmount: { [currencyCode: string]: string },
  networkFee: { [currencyCode: string]: string }
}

export type CurrencyWalletState = {
  +accountId: string,
  +pluginId: string,

  +paused: boolean,

  +balances: EdgeBalances,
  +currencyInfo: EdgeCurrencyInfo,
  +displayPrivateSeed: string | null,
  +displayPublicSeed: string | null,
  +enabledTokenIds: string[],
  +enabledTokens: string[],
  +engineFailure: Error | null,
  +engineStarted: boolean,
  +fiat: string,
  +fiatLoaded: boolean,
  +fileNames: TxFileNames,
  +fileNamesLoaded: boolean,
  +files: TxFileJsons,
  +gotTxs: { [currencyCode: string]: boolean },
  +height: number,
  +name: string | null,
  +nameLoaded: boolean,
  +publicWalletInfo: EdgeWalletInfo | null,
  +sortedTransactions: SortedTransactions,
  +stakingStatus: EdgeStakingStatus,
  +syncRatio: number,
  +txids: string[],
  +txs: { [txid: string]: MergedTransaction },
  +walletInfo: EdgeWalletInfoFull
}

export type CurrencyWalletNext = {
  +id: string,
  +root: RootState,
  +self: CurrencyWalletState
}

export const initialEnabledTokens: string[] = []

const currencyWalletInner: FatReducer<
  CurrencyWalletState,
  RootAction,
  CurrencyWalletNext
> = buildReducer({
  accountId(state, action: RootAction, next: CurrencyWalletNext): string {
    if (state != null) return state
    for (const accountId of Object.keys(next.root.accounts)) {
      const account = next.root.accounts[accountId]
      for (const walletId of Object.keys(account.walletInfos)) {
        if (walletId === next.id) return accountId
      }
    }
    throw new Error(`Cannot find account for walletId ${next.id}`)
  },

  pluginId: memoizeReducer(
    next => next.root.login.walletInfos[next.id].type,
    next => next.root.plugins.currency,
    (walletType: string, plugins): string => {
      return findCurrencyPluginId(plugins, walletType)
    }
  ),

  paused(
    state: boolean | void,
    action: RootAction,
    next: CurrencyWalletNext
  ): boolean {
    return state == null
      ? next.root.accounts[next.self.accountId].pauseWallets
      : action.type === 'CURRENCY_WALLET_CHANGED_PAUSED'
      ? action.payload.paused
      : state
  },

  currencyInfo(
    state,
    action: RootAction,
    next: CurrencyWalletNext
  ): EdgeCurrencyInfo {
    if (state != null) return state
    const { pluginId } = next.self
    return next.root.plugins.currency[pluginId].currencyInfo
  },

  displayPrivateSeed(state = null, action: RootAction): string | null {
    return action.type === 'CURRENCY_ENGINE_CHANGED_SEEDS'
      ? action.payload.displayPrivateSeed
      : state
  },

  displayPublicSeed(state = null, action: RootAction): string | null {
    return action.type === 'CURRENCY_ENGINE_CHANGED_SEEDS'
      ? action.payload.displayPublicSeed
      : state
  },

  enabledTokenIds: memoizeReducer(
    (next: CurrencyWalletNext) =>
      next.root.accounts[next.self.accountId].builtinTokens[next.self.pluginId],
    (next: CurrencyWalletNext) =>
      next.root.accounts[next.self.accountId].customTokens[next.self.pluginId],
    (next: CurrencyWalletNext) => next.self.currencyInfo,
    (next: CurrencyWalletNext) => next.self.enabledTokens,
    currencyCodesToTokenIds
  ),

  enabledTokens(
    state: string[] = initialEnabledTokens,
    action: RootAction
  ): string[] {
    if (action.type === 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED') {
      const { currencyCodes } = action.payload
      // Check for actual changes:
      currencyCodes.sort((a, b) => (a === b ? 0 : a > b ? 1 : -1))
      if (!compare(currencyCodes, state)) return currencyCodes
    }
    return state
  },

  engineFailure(state = null, action: RootAction): Error | null {
    return action.type === 'CURRENCY_ENGINE_FAILED'
      ? action.payload.error
      : state
  },

  engineStarted(state = false, action: RootAction): boolean {
    return action.type === 'CURRENCY_ENGINE_STARTED'
      ? true
      : action.type === 'CURRENCY_ENGINE_STOPPED'
      ? false
      : state
  },

  fiat(state = '', action: RootAction): string {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED'
      ? action.payload.fiatCurrencyCode
      : state
  },

  fiatLoaded(state = false, action: RootAction): boolean {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED' ? true : state
  },

  files(state: TxFileJsons = {}, action: RootAction): TxFileJsons {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { json, txidHash } = action.payload
        const out = { ...state }
        out[txidHash] = json
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

  sortedTransactions(
    state = { txidHashes: {}, sortedList: [] },
    action: RootAction
  ): SortedTransactions {
    const { txidHashes } = state
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        return sortTxs(txidHashes, action.payload.txidHashes)
      }
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { txFileNames } = action.payload
        const newTxidHashes = {}
        for (const txidHash of Object.keys(txFileNames)) {
          newTxidHashes[txidHash] = txFileNames[txidHash].creationDate
        }
        return sortTxs(txidHashes, newTxidHashes)
      }
    }
    return state
  },

  fileNames(state = {}, action: RootAction): TxFileNames {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { txFileNames } = action.payload
        return {
          ...state,
          ...txFileNames
        }
      }
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { fileName, creationDate, txidHash } = action.payload
        if (
          state[txidHash] == null ||
          creationDate < state[txidHash].creationDate
        ) {
          state[txidHash] = { creationDate, fileName }
        }
        return state
      }
    }
    return state
  },

  fileNamesLoaded(state = false, action: RootAction): boolean {
    return action.type === 'CURRENCY_WALLET_FILE_NAMES_LOADED' ? true : state
  },

  syncRatio(state = 0, action: RootAction): number {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_SYNC_RATIO': {
        return action.payload.ratio
      }
      case 'CURRENCY_ENGINE_CLEARED': {
        return 0
      }
    }
    return state
  },

  balances(state = {}, action: RootAction): EdgeBalances {
    if (action.type === 'CURRENCY_ENGINE_CHANGED_BALANCE') {
      const out = { ...state }
      out[action.payload.currencyCode] = action.payload.balance
      return out
    }
    return state
  },

  height(state = 0, action: RootAction): number {
    return action.type === 'CURRENCY_ENGINE_CHANGED_HEIGHT'
      ? action.payload.height
      : state
  },

  name(state = null, action: RootAction): string | null {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED'
      ? action.payload.name
      : state
  },

  nameLoaded(state = false, action: RootAction): boolean {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED' ? true : state
  },

  stakingStatus(
    state: EdgeStakingStatus = { stakedAmounts: [] },
    action: RootAction
  ): EdgeStakingStatus {
    return action.type === 'CURRENCY_ENGINE_CHANGED_STAKING'
      ? action.payload.stakingStatus
      : state
  },

  txids: memoizeReducer(
    (next: CurrencyWalletNext) => next.self.txs,
    (txs): string[] => Object.keys(txs)
  ),

  txs(
    state = {},
    action: RootAction,
    next: CurrencyWalletNext
  ): { [txid: string]: MergedTransaction } {
    switch (action.type) {
      case 'CHANGE_MERGE_TX': {
        const { tx } = action.payload
        const out = { ...state }
        out[tx.txid] = tx
        return out
      }
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

  gotTxs(state = {}, action: RootAction): { [currencyCode: string]: boolean } {
    if (action.type === 'CURRENCY_ENGINE_GOT_TXS') {
      state[action.payload.currencyCode] = true
    }
    return state
  },

  walletInfo(state, action: RootAction, next: CurrencyWalletNext) {
    return next.root.login.walletInfos[next.id]
  },

  publicWalletInfo(state = null, action: RootAction): EdgeWalletInfo | null {
    return action.type === 'CURRENCY_WALLET_PUBLIC_INFO'
      ? action.payload.walletInfo
      : state
  }
})

export function sortTxs(
  txidHashes: TxidHashes,
  newHashes: TxidHashes
): {
  sortedList: string[],
  txidHashes: TxidHashes
} {
  for (const newTxidHash of Object.keys(newHashes)) {
    const newTime = newHashes[newTxidHash]
    if (txidHashes[newTxidHash] == null || newTime < txidHashes[newTxidHash]) {
      txidHashes[newTxidHash] = newTime
    }
  }
  const sortedList: string[] = Object.keys(txidHashes).sort(
    (txidHash1, txidHash2) => {
      if (txidHashes[txidHash1] > txidHashes[txidHash2]) return -1
      if (txidHashes[txidHash1] < txidHashes[txidHash2]) return 1
      return 0
    }
  )
  return { sortedList, txidHashes }
}

export const currencyWalletReducer: FatReducer<
  CurrencyWalletState,
  RootAction,
  CurrencyWalletNext
> = filterReducer(
  currencyWalletInner,
  (action: RootAction, next: CurrencyWalletNext): RootAction => {
    return /^CURRENCY_/.test(action.type) &&
      action.payload != null &&
      action.payload.walletId === next.id
      ? action
      : { type: 'UPDATE_NEXT' }
  }
)

const defaultTx: MergedTransaction = {
  confirmations: 'unconfirmed',
  currencyCode: '',
  blockHeight: 0,
  date: 0,
  ourReceiveAddresses: [],
  signedTx: '',
  txid: '',
  nativeAmount: {},
  networkFee: {},
  providerFee: {}
}

/**
 * Merges a new incoming transaction with an existing transaction.
 */
export function mergeTx(
  tx: EdgeTransaction,
  defaultCurrency: string,
  oldTx: MergedTransaction = defaultTx
): MergedTransaction {
  const currencyCode =
    tx.currencyCode != null ? tx.currencyCode : defaultCurrency
  const out = {
    confirmations: tx.confirmations ?? 'unconfirmed',
    currencyCode,
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,
    otherParams: tx.otherParams,

    nativeAmount: { ...oldTx.nativeAmount },
    networkFee: { ...oldTx.networkFee }
  }

  out.nativeAmount[currencyCode] = tx.nativeAmount
  out.networkFee[currencyCode] =
    tx.networkFee != null ? tx.networkFee.toString() : '0'

  if (tx.parentNetworkFee != null) {
    out.networkFee[defaultCurrency] = String(tx.parentNetworkFee)
  }

  return out
}

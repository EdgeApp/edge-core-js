import { lt } from 'biggystring'
import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import {
  EdgeBalances,
  EdgeCurrencyInfo,
  EdgeMemo,
  EdgeStakingStatus,
  EdgeTokenId,
  EdgeTransaction,
  EdgeTxAction,
  EdgeWalletInfo,
  EdgeWalletInfoFull
} from '../../../types/types'
import { compare } from '../../../util/compare'
import { RootAction } from '../../actions'
import { findCurrencyPluginId } from '../../plugins/plugins-selectors'
import { RootState } from '../../root-reducer'
import { TransactionFile } from './currency-wallet-cleaners'
import { uniqueStrings } from './enabled-tokens'

/** Maps from txid hash to file creation date & path. */
export interface TxFileNames {
  [txidHash: string]: {
    creationDate: number
    fileName: string
  }
}

/** Maps from txid hash to file contents (in JSON). */
export interface TxFileJsons {
  [txidHash: string]: TransactionFile
}

/** Maps from txid hash to creation date. */
export interface TxidHashes {
  [txidHash: string]: {
    date: number
    txid?: string
  }
}

export interface MergedTransaction {
  action?: EdgeTxAction
  blockHeight: number
  confirmations: EdgeTransaction['confirmations']
  date: number
  isSend: boolean
  memos: EdgeMemo[]
  otherParams?: object
  ourReceiveAddresses: string[]
  signedTx: string
  txid: string
  nativeAmount: Map<EdgeTokenId, string>
  networkFee: Map<EdgeTokenId, string>
}

export interface CurrencyWalletState {
  readonly accountId: string
  readonly pluginId: string

  readonly paused: boolean

  readonly allEnabledTokenIds: string[]
  readonly balances: EdgeBalances
  readonly currencyInfo: EdgeCurrencyInfo
  readonly detectedTokenIds: string[]
  readonly enabledTokenIds: string[]
  readonly engineFailure: Error | null
  readonly engineStarted: boolean
  readonly fiat: string
  readonly fiatLoaded: boolean
  readonly fileNames: TxFileNames
  readonly files: TxFileJsons
  readonly gotTxs: Set<EdgeTokenId>
  readonly height: number
  readonly name: string | null
  readonly nameLoaded: boolean
  readonly publicWalletInfo: EdgeWalletInfo | null
  readonly sortedTxidHashes: string[]
  readonly stakingStatus: EdgeStakingStatus
  readonly syncRatio: number
  readonly txidHashes: TxidHashes
  readonly txs: { [txid: string]: MergedTransaction }
  readonly unactivatedTokenIds: string[]
  readonly walletInfo: EdgeWalletInfoFull
}

export interface CurrencyWalletNext {
  readonly id: string
  readonly root: RootState
  readonly self: CurrencyWalletState
}

// Used for detectedTokenIds & enabledTokenIds:
export const initialTokenIds: string[] = []

const currencyWalletInner = buildReducer<
  CurrencyWalletState,
  RootAction,
  CurrencyWalletNext
>({
  accountId(state, action, next): string {
    if (state != null) return state
    for (const accountId of Object.keys(next.root.accounts)) {
      const account = next.root.accounts[accountId]
      for (const walletId of Object.keys(account.walletInfos)) {
        if (walletId === next.id) return accountId
      }
    }
    throw new Error(`Cannot find account for walletId ${next.id}`)
  },

  allEnabledTokenIds: memoizeReducer(
    (next: CurrencyWalletNext) =>
      next.root.accounts[next.self.accountId].alwaysEnabledTokenIds[
        next.self.pluginId
      ],
    (next: CurrencyWalletNext) => next.self.enabledTokenIds,
    (alwaysEnabledTokenIds = [], enabledTokenIds = []) =>
      uniqueStrings([...alwaysEnabledTokenIds, ...enabledTokenIds])
  ),

  pluginId: memoizeReducer(
    next => next.root.login.walletInfos[next.id].type,
    next => next.root.plugins.currency,
    (walletType: string, plugins): string => {
      return findCurrencyPluginId(plugins, walletType)
    }
  ),

  paused(state, action, next): boolean {
    return state == null
      ? next.root.accounts[next.self.accountId].pauseWallets
      : action.type === 'CURRENCY_WALLET_CHANGED_PAUSED'
      ? action.payload.paused
      : state
  },

  currencyInfo(state, action, next): EdgeCurrencyInfo {
    if (state != null) return state
    const { pluginId } = next.self
    return next.root.plugins.currency[pluginId].currencyInfo
  },

  detectedTokenIds: sortStringsReducer(
    (state = initialTokenIds, action): string[] => {
      if (action.type === 'CURRENCY_WALLET_LOADED_TOKEN_FILE') {
        return action.payload.detectedTokenIds
      } else if (action.type === 'CURRENCY_ENGINE_DETECTED_TOKENS') {
        const { detectedTokenIds } = action.payload
        return uniqueStrings([...state, ...detectedTokenIds])
      } else if (action.type === 'CURRENCY_ENGINE_CLEARED') {
        return []
      }
      return state
    }
  ),

  enabledTokenIds: sortStringsReducer(
    (state = initialTokenIds, action): string[] => {
      if (action.type === 'CURRENCY_WALLET_LOADED_TOKEN_FILE') {
        return action.payload.enabledTokenIds
      } else if (action.type === 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED') {
        return action.payload.enabledTokenIds
      } else if (action.type === 'CURRENCY_ENGINE_DETECTED_TOKENS') {
        const { enablingTokenIds } = action.payload
        return uniqueStrings([...state, ...enablingTokenIds])
      }
      return state
    }
  ),

  engineFailure(state = null, action): Error | null {
    if (action.type === 'CURRENCY_ENGINE_FAILED') {
      const { error } = action.payload
      if (error instanceof Error) return error
      return new Error(String(error))
    }
    return state
  },

  engineStarted(state = false, action): boolean {
    return action.type === 'CURRENCY_ENGINE_STARTED'
      ? true
      : action.type === 'CURRENCY_ENGINE_STOPPED'
      ? false
      : state
  },

  fiat(state = '', action): string {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED'
      ? action.payload.fiatCurrencyCode
      : state
  },

  fiatLoaded(state = false, action): boolean {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED' ? true : state
  },

  files(state = {}, action): TxFileJsons {
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

  fileNames(state = {}, action): TxFileNames {
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

  syncRatio(state = 0, action): number {
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

  balances(state = {}, action): EdgeBalances {
    if (action.type === 'CURRENCY_ENGINE_CHANGED_BALANCE') {
      const out = { ...state }
      out[action.payload.currencyCode] = action.payload.balance
      return out
    }
    return state
  },

  height(state = 0, action): number {
    return action.type === 'CURRENCY_ENGINE_CHANGED_HEIGHT'
      ? action.payload.height
      : state
  },

  name(state = null, action): string | null {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED'
      ? action.payload.name
      : state
  },

  nameLoaded(state = false, action): boolean {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED' ? true : state
  },

  sortedTxidHashes: memoizeReducer(
    next => next.self.txidHashes,
    txidHashes =>
      Object.keys(txidHashes).sort((txidHash1, txidHash2) => {
        if (txidHashes[txidHash1].date > txidHashes[txidHash2].date) return -1
        if (txidHashes[txidHash1].date < txidHashes[txidHash2].date) return 1
        return 0
      })
  ),

  stakingStatus(state = { stakedAmounts: [] }, action): EdgeStakingStatus {
    return action.type === 'CURRENCY_ENGINE_CHANGED_STAKING'
      ? action.payload.stakingStatus
      : state
  },

  txidHashes(state = {}, action) {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        return mergeTxidHashes(state, action.payload.txidHashes)
      }
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { txFileNames } = action.payload
        const newTxidHashes: TxidHashes = {}
        for (const txidHash of Object.keys(txFileNames)) {
          newTxidHashes[txidHash] = {
            date: txFileNames[txidHash].creationDate
          }
        }
        return mergeTxidHashes(state, newTxidHashes)
      }
    }
    return state
  },

  txs(state = {}, action, next): { [txid: string]: MergedTransaction } {
    switch (action.type) {
      case 'CHANGE_MERGE_TX': {
        const { tx } = action.payload
        const out = { ...state }
        out[tx.txid] = tx
        return out
      }
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        const { txs } = action.payload
        const out = { ...state }
        for (const tx of txs) {
          out[tx.txid] = mergeTx(tx, out[tx.txid])
        }
        return out
      }
      case 'CURRENCY_ENGINE_CLEARED':
        return {}
    }
    return state
  },

  unactivatedTokenIds(state = [], action): string[] {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_UNACTIVATED_TOKEN_IDS': {
        return action.payload.unactivatedTokenIds
      }
      case 'CURRENCY_ENGINE_CLEARED': {
        return []
      }
    }
    return state
  },

  gotTxs(state = new Set(), action): Set<EdgeTokenId> {
    switch (action.type) {
      case 'CURRENCY_ENGINE_GOT_TXS': {
        const { tokenId } = action.payload
        const out = new Set(state)
        out.add(tokenId)
        return out
      }
      case 'CURRENCY_ENGINE_CLEARED':
        return new Set()
      default:
        return state
    }
  },

  walletInfo(state, action, next) {
    return next.root.login.walletInfos[next.id]
  },

  publicWalletInfo(state = null, action): EdgeWalletInfo | null {
    return action.type === 'CURRENCY_WALLET_PUBLIC_INFO'
      ? action.payload.walletInfo
      : state
  }
})

function mergeTxidHashes(a: TxidHashes, b: TxidHashes): TxidHashes {
  const out: TxidHashes = { ...a }
  for (const hash of Object.keys(b)) {
    const oldItem = out[hash]
    const newItem = b[hash]
    out[hash] =
      oldItem == null
        ? newItem
        : {
            date: Math.min(newItem.date, oldItem.date),
            txid: newItem.txid ?? oldItem.txid
          }
  }
  return out
}

export const currencyWalletReducer = filterReducer<
  CurrencyWalletState,
  RootAction,
  CurrencyWalletNext,
  RootAction
>(currencyWalletInner, (action, next) => {
  return /^CURRENCY_/.test(action.type) &&
    'payload' in action &&
    typeof action.payload === 'object' &&
    'walletId' in action.payload &&
    action.payload.walletId === next.id
    ? action
    : { type: 'UPDATE_NEXT' }
})

/**
 * Merges a new incoming transaction with an existing transaction.
 */
export function mergeTx(
  tx: EdgeTransaction,
  oldTx: MergedTransaction | undefined
): MergedTransaction {
  const {
    action,
    isSend = lt(tx.nativeAmount, '0'),
    memos,
    tokenId = null
  } = tx

  const out: MergedTransaction = {
    action,
    blockHeight: tx.blockHeight,
    confirmations: tx.confirmations ?? 'unconfirmed',
    date: tx.date,
    isSend,
    memos,
    nativeAmount: new Map(oldTx?.nativeAmount ?? []),
    networkFee: new Map(oldTx?.networkFee ?? []),
    otherParams: tx.otherParams,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid
  }
  out.nativeAmount.set(tokenId, tx.nativeAmount)
  out.networkFee.set(tokenId, tx.networkFee ?? '0')
  if (tx.parentNetworkFee != null) {
    out.networkFee.set(null, String(tx.parentNetworkFee))
  }

  return out
}

type StringsReducer = (
  state: string[] | undefined,
  action: RootAction
) => string[]

function sortStringsReducer(reducer: StringsReducer): StringsReducer {
  return (state, action) => {
    const out = reducer(state, action)
    if (out === state) return state

    out.sort((a, b) => (a === b ? 0 : a > b ? 1 : -1))
    if (state == null || !compare(out, state)) return out
    return state
  }
}

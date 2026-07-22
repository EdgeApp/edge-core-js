import { lt } from 'biggystring'
import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import {
  EdgeAddress,
  EdgeAssetAction,
  EdgeBalanceMap,
  EdgeBalances,
  EdgeCurrencyInfo,
  EdgeMemo,
  EdgeStakingStatus,
  EdgeSyncStatus,
  EdgeTokenId,
  EdgeTransaction,
  EdgeTxAction,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  JsonObject
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
  blockHeight: number
  chainAction?: EdgeTxAction
  chainAssetAction: Map<EdgeTokenId, EdgeAssetAction>
  confirmations: EdgeTransaction['confirmations']
  date: number
  feeRateUsed?: object
  isSend: boolean
  memos: EdgeMemo[]
  nativeAmount: EdgeBalanceMap
  networkFee: EdgeBalanceMap
  otherParams?: object
  ourReceiveAddresses: string[]
  signedTx: string
  txid: string
}

export interface CurrencyWalletState {
  readonly accountId: string
  readonly pluginId: string

  readonly paused: boolean

  readonly addresses: EdgeAddress[]
  readonly allEnabledTokenIds: string[]
  readonly balanceMap: EdgeBalanceMap
  readonly balances: EdgeBalances
  readonly changeServiceSubscriptions: ChangeServiceSubscription[]
  readonly currencyInfo: EdgeCurrencyInfo
  readonly detectedTokenIds: string[]
  readonly enabledTokenIds: string[]
  readonly enabledTokensDirtyIds: string[]
  readonly tokenFileDirty: boolean
  readonly tokenFileLoaded: boolean
  readonly walletSettings: JsonObject
  readonly walletSettingsDirty: boolean
  readonly engineFailure: Error | null
  readonly engineStarted: boolean
  readonly fiat: string
  readonly fiatDirty: boolean
  readonly fiatLoaded: boolean
  readonly fileNames: TxFileNames
  readonly files: TxFileJsons
  readonly gotTxs: Set<EdgeTokenId>
  readonly height: number
  readonly name: string | null
  readonly nameDirty: boolean
  readonly nameLoaded: boolean
  readonly otherMethodNames: string[]
  readonly publicWalletInfo: EdgeWalletInfo | null
  readonly seenTxCheckpoint: string | null
  readonly sortedTxidHashes: string[]
  readonly stakingStatus: EdgeStakingStatus
  readonly syncStatus: EdgeSyncStatus
  readonly txidHashes: TxidHashes
  readonly txs: { [txid: string]: MergedTransaction }
  readonly unactivatedTokenIds: string[]
  readonly walletInfo: EdgeWalletInfoFull
}

export interface ChangeServiceSubscription {
  address: string
  status: ChangeServiceSubscriptionStatus
  checkpoint?: string
}

export type ChangeServiceSubscriptionStatus =
  | 'avoiding' // The wallet is avoiding the change service (unsupported)
  | 'listening' // The wallet is connected and listening for changes
  | 'reconnecting' // The wallet is reconnecting to the change service while its not available
  | 'subscribing' // The wallet is in the process of subscribing (supported)
  | 'subscribingSlowly' // The wallet is subscribing but response is slow, polling enabled
  | 'resubscribing' // The wallet is in the process of resubscribing due to a change-server issue (supported)
  | 'synced' // The wallet is synced to the latest network state
  | 'syncing' // The wallet is syncing historical data

export interface CurrencyWalletNext {
  readonly id: string
  readonly root: RootState
  readonly self: CurrencyWalletState
}

export const initialWalletSettings: JsonObject = {}

export const initialAddresses: EdgeAddress[] = []

// Used for detectedTokenIds & enabledTokenIds:
export const initialTokenIds: string[] = []

export const initialSyncStatus: EdgeSyncStatus = {
  totalRatio: 0
}

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
    (state = initialTokenIds, action, next, prev): string[] => {
      if (action.type === 'CURRENCY_WALLET_LOADED_TOKEN_FILE') {
        // Unsaved user toggles win over the file we just loaded, but
        // only for the token ids the user actually touched - the
        // rest of the file may hold changes from another device.
        // The toggles stay dirty, so the tokenSaver writes them out:
        const dirtyIds = prev?.self.enabledTokensDirtyIds ?? []
        if (dirtyIds.length === 0) return action.payload.enabledTokenIds
        const enabled = dirtyIds.filter(id => state.includes(id))
        const disabled = dirtyIds.filter(id => !state.includes(id))
        return uniqueStrings(
          [...action.payload.enabledTokenIds, ...enabled],
          disabled
        )
      } else if (action.type === 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED') {
        return action.payload.enabledTokenIds
      } else if (action.type === 'CURRENCY_WALLET_CACHE_LOADED') {
        return action.payload.enabledTokenIds
      } else if (action.type === 'CURRENCY_ENGINE_DETECTED_TOKENS') {
        const { enablingTokenIds } = action.payload
        return uniqueStrings([...state, ...enablingTokenIds])
      }
      return state
    }
  ),

  changeServiceSubscriptions(state = [], action) {
    if (action.type === 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS') {
      const filteredState = state.filter(subscription => {
        return !action.payload.subscriptions.some(
          sub => sub.address === subscription.address
        )
      })
      return [...filteredState, ...action.payload.subscriptions]
    }
    if (action.type === 'CURRENCY_WALLET_LOADED_SUBSCRIBED_ADDRESSES') {
      // When loading from disk, replace the state with loaded subscriptions
      return action.payload.subscribedAddresses
    }
    return state
  },

  enabledTokensDirtyIds(state = initialTokenIds, action, next, prev): string[] {
    switch (action.type) {
      case 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED':
      case 'CURRENCY_ENGINE_DETECTED_TOKENS': {
        // Remember which ids these actions actually toggled, so a
        // racing load can preserve exactly those:
        const prevIds = prev?.self.enabledTokenIds ?? initialTokenIds
        const nextIds = next.self.enabledTokenIds
        if (nextIds === prevIds) return state
        const toggled = [
          ...nextIds.filter(id => !prevIds.includes(id)),
          ...prevIds.filter(id => !nextIds.includes(id))
        ].filter(id => !state.includes(id))
        return toggled.length === 0 ? state : [...state, ...toggled]
      }

      case 'CURRENCY_WALLET_SAVED_TOKEN_FILE':
        // The toggles are on disk, so a future load will include them:
        return state.length === 0 ? state : []
    }
    return state
  },

  tokenFileDirty(state = false, action, next, prev): boolean {
    switch (action.type) {
      case 'CURRENCY_WALLET_LOADED_TOKEN_FILE':
        // Stay dirty if the user changed tokens before the file loaded,
        // so the tokenSaver writes those changes back out:
        return state

      case 'CURRENCY_WALLET_SAVED_TOKEN_FILE':
        // The file has been synced to disk, so it's not dirty:
        return false

      case 'CURRENCY_ENGINE_CLEARED':
      case 'CURRENCY_ENGINE_DETECTED_TOKENS':
      case 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED':
        // These actions might update the file, so check for diffs:
        return (
          next.self.detectedTokenIds !== prev.self.detectedTokenIds ||
          next.self.enabledTokenIds !== prev.self.enabledTokenIds
        )

      default:
        return state
    }
  },

  tokenFileLoaded(state = false, action): boolean {
    switch (action.type) {
      case 'CURRENCY_WALLET_LOADED_TOKEN_FILE':
        return true

      case 'CURRENCY_ENGINE_CLEARED':
        return false
      default:
        return state
    }
  },

  walletSettings(
    state = initialWalletSettings,
    action,
    next,
    prev
  ): JsonObject {
    switch (action.type) {
      case 'CURRENCY_WALLET_LOADED_WALLET_SETTINGS_FILE':
        // A user change made while the file load was reading the disk
        // wins over the value the load saw (the change already wrote
        // the file before dispatching):
        if (prev.self?.walletSettingsDirty) return state
        return action.payload.walletSettings
      case 'CURRENCY_WALLET_CHANGED_WALLET_SETTINGS':
        return action.payload.walletSettings
      default:
        return state
    }
  },

  walletSettingsDirty(state = false, action): boolean {
    switch (action.type) {
      case 'CURRENCY_WALLET_CHANGED_WALLET_SETTINGS':
        return true
      case 'CURRENCY_WALLET_LOADED_WALLET_SETTINGS_FILE':
        return false
    }
    return state
  },

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

  fiat(state = '', action, next, prev): string {
    switch (action.type) {
      case 'CURRENCY_WALLET_CACHE_LOADED':
        return action.payload.fiatCurrencyCode

      case 'CURRENCY_WALLET_FIAT_CHANGED':
        // A user change made while the file load was reading the disk
        // wins over the value the load saw (the change already wrote
        // the file before dispatching):
        if (action.payload.fromFile === true && prev.self?.fiatDirty)
          return state
        return action.payload.fiatCurrencyCode
    }
    return state
  },

  fiatDirty(state = false, action): boolean {
    if (action.type === 'CURRENCY_WALLET_FIAT_CHANGED') {
      return action.payload.fromFile !== true
    }
    return state
  },

  fiatLoaded(state = false, action): boolean {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED' ||
      action.type === 'CURRENCY_WALLET_CACHE_LOADED'
      ? true
      : state
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

  syncStatus(state = initialSyncStatus, action): EdgeSyncStatus {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_SYNC_STATUS': {
        return action.payload.status
      }
      case 'CURRENCY_ENGINE_CLEARED': {
        return initialSyncStatus
      }
    }
    return state
  },

  otherMethodNames: sortStringsReducer(
    (state = initialTokenIds, action): string[] => {
      switch (action.type) {
        case 'CURRENCY_WALLET_OTHER_METHOD_NAMES_CHANGED':
          // The engine's method list is authoritative:
          return action.payload.names

        case 'CURRENCY_WALLET_CACHE_LOADED':
          // Seed cached names, but never overwrite an engine answer
          // (the seed only ever fires before the engine exists):
          if (state.length > 0) return state
          return action.payload.otherMethodNames
      }
      return state
    }
  ),

  addresses(state = initialAddresses, action): EdgeAddress[] {
    switch (action.type) {
      case 'CURRENCY_WALLET_ADDRESSES_CHANGED':
        // The engine's answer is authoritative:
        return action.payload.addresses

      case 'CURRENCY_WALLET_CACHE_LOADED':
        // Seed cached addresses, but never overwrite an engine answer
        // (the seed only ever fires before the engine exists):
        if (state.length > 0) return state
        return action.payload.addresses
    }
    return state
  },

  balanceMap(state = new Map(), action): Map<EdgeTokenId, string> {
    if (action.type === 'CURRENCY_ENGINE_CHANGED_BALANCE') {
      const { balance, tokenId } = action.payload
      // Keep the existing Map when nothing changed, so downstream
      // reference checks (memoized reducers, the cache saver, yaob
      // diffing) see no phantom update:
      if (state.get(tokenId) === balance) return state
      const out = new Map(state)
      out.set(tokenId, balance)
      return out
    }
    if (action.type === 'CURRENCY_WALLET_CACHE_LOADED') {
      // Seed cached balances, but never overwrite live engine data:
      const out = new Map(state)
      for (const [tokenId, balance] of action.payload.balanceMap) {
        if (!out.has(tokenId)) out.set(tokenId, balance)
      }
      return out
    }
    return state
  },

  balances: memoizeReducer(
    next => next.self.balanceMap,
    next => next.self.currencyInfo,
    next =>
      next.root.accounts[next.self.accountId].allTokens[next.self.pluginId],
    (balanceMap, currencyInfo, allTokens = {}) => {
      const out: EdgeBalances = {}
      for (const tokenId of balanceMap.keys()) {
        const balance = balanceMap.get(tokenId)
        // A cached token balance can arrive before the deferred
        // builtin-token load defines its token; skip it until then:
        const tokenInfo = tokenId == null ? currencyInfo : allTokens[tokenId]
        if (tokenInfo == null) continue
        const { currencyCode } = tokenInfo
        if (balance != null) out[currencyCode] = balance
      }
      return out
    }
  ),

  height(state = 0, action): number {
    return action.type === 'CURRENCY_ENGINE_CHANGED_HEIGHT'
      ? action.payload.height
      : state
  },

  name(state = null, action, next, prev): string | null {
    switch (action.type) {
      case 'CURRENCY_WALLET_CACHE_LOADED':
        return action.payload.name

      case 'CURRENCY_WALLET_NAME_CHANGED':
        // A user rename made while the file load was reading the disk
        // wins over the value the load saw (the rename already wrote
        // the file before dispatching):
        if (action.payload.fromFile === true && prev.self?.nameDirty)
          return state
        return action.payload.name
    }
    return state
  },

  nameDirty(state = false, action): boolean {
    if (action.type === 'CURRENCY_WALLET_NAME_CHANGED') {
      return action.payload.fromFile !== true
    }
    return state
  },

  nameLoaded(state = false, action): boolean {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED' ||
      action.type === 'CURRENCY_WALLET_CACHE_LOADED'
      ? true
      : state
  },

  seenTxCheckpoint(state = null, action) {
    return action.type === 'CURRENCY_ENGINE_SEEN_TX_CHECKPOINT_CHANGED'
      ? action.payload.checkpoint
      : state
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
    switch (action.type) {
      case 'CURRENCY_WALLET_PUBLIC_INFO':
        return action.payload.walletInfo

      case 'CURRENCY_WALLET_CACHE_LOADED':
        return action.payload.publicWalletInfo ?? state
    }
    return state
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
  // The bulk loader seeds every wallet in one dispatch;
  // hand each wallet its own seed as the per-wallet action:
  if (action.type === 'CURRENCY_WALLETS_CACHE_LOADED') {
    const seed = action.payload.seeds[next.id]
    if (seed == null) return { type: 'UPDATE_NEXT' }
    return {
      type: 'CURRENCY_WALLET_CACHE_LOADED',
      payload: { ...seed, walletId: next.id }
    }
  }

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
    confirmations = 'unconfirmed',
    isSend = lt(tx.nativeAmount, '0'),
    tokenId = null
  } = tx

  const out: MergedTransaction = {
    blockHeight: tx.blockHeight,
    chainAction: tx.chainAction,
    chainAssetAction: new Map(oldTx?.chainAssetAction ?? []),
    confirmations,
    date: tx.date,
    isSend,
    memos: tx.memos,
    nativeAmount: new Map(oldTx?.nativeAmount ?? []),
    networkFee: new Map(oldTx?.networkFee ?? []),
    otherParams: tx.otherParams,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid
  }
  out.nativeAmount.set(tokenId, tx.nativeAmount)
  out.networkFee.set(tokenId, tx.networkFee ?? '0')
  if (tx.feeRateUsed != null) {
    out.feeRateUsed = tx.feeRateUsed
  }
  if (tx.parentNetworkFee != null) {
    out.networkFee.set(null, String(tx.parentNetworkFee))
  }
  if (tx.chainAssetAction != null) {
    out.chainAssetAction.set(tokenId, tx.chainAssetAction)
  }

  return out
}

type StringsReducer = (
  state: string[] | undefined,
  action: RootAction,
  next?: CurrencyWalletNext,
  prev?: CurrencyWalletNext
) => string[]

function sortStringsReducer(reducer: StringsReducer): StringsReducer {
  return (state, action, next, prev) => {
    const out = reducer(state, action, next, prev)
    if (out === state) return state

    out.sort((a, b) => (a === b ? 0 : a > b ? 1 : -1))
    if (state == null || !compare(out, state)) return out
    return state
  }
}

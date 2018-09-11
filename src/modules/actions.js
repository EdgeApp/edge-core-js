// @flow

import type {
  EdgeAccountCallbacks,
  EdgeCurrencyInfo,
  EdgeTokenInfo,
  EdgeWalletInfo,
  EdgeWalletStates
} from '../edge-core-index.js'
import type { PluginSettings } from './currency/currency-reducer.js'
import type {
  TxFileJsons,
  TxFileNames
} from './currency/wallet/currency-wallet-reducer.js'
import type { ExchangePair } from './exchange/exchange-reducer.js'
import type { LoginStash } from './login/login-types.js'
import type {
  StorageWalletState,
  StorageWalletStatus
} from './storage/storage-reducer.js'

/**
 * The account fires this when the user sorts or archives wallets.
 */
export type AccountChangedWalletStates = {
  type: 'ACCOUNT_CHANGED_WALLET_STATES',
  payload: {
    accountId: string,
    walletStates: EdgeWalletStates
  }
}

/**
 * The account fires this when it loads its keys from disk.
 */
export type AccountKeysLoadedAction = {
  type: 'ACCOUNT_KEYS_LOADED',
  payload: {
    accountId: string,
    legacyWalletInfos: Array<EdgeWalletInfo>,
    walletStates: EdgeWalletStates
  }
}

/**
 * The account encountered an error when initializing itself.
 */
export type AccountLoadFailed = {
  type: 'ACCOUNT_LOAD_FAILED',
  payload: {
    accountId: string,
    error: Error
  }
}

/**
 * Somebody just added a custom token type to the wallet.
 */
export type AddedCustomToken = {
  type: 'ADDED_CUSTOM_TOKEN',
  payload: EdgeTokenInfo
}

/**
 * Fired when somebody changes the currency settings for a plugin.
 */
export type ChangedCurrencyPluginSettingAction = {
  type: 'CHANGED_CURRENCY_PLUGIN_SETTING',
  payload: {
    pluginName: string,
    settings: Object
  }
}

/**
 * Called when a currency engine fires the onBalanceChanged callback.
 */
export type CurrencyEngineChangedBalance = {
  type: 'CURRENCY_ENGINE_CHANGED_BALANCE',
  payload: {
    balance: string,
    currencyCode: string,
    walletId: string
  }
}

/**
 * Called when a currency engine fires the onBlockHeightChanged callback.
 */
export type CurrencyEngineChangedHeight = {
  type: 'CURRENCY_ENGINE_CHANGED_HEIGHT',
  payload: {
    height: number,
    walletId: string
  }
}

/**
 * Called when a currency engine returns the display private & public seeds.
 */
export type CurrencyEngineChangedSeeds = {
  type: 'CURRENCY_ENGINE_CHANGED_SEEDS',
  payload: {
    displayPublicSeed: string | null,
    displayPrivateSeed: string | null,
    walletId: string
  }
}

/**
 * Called when a currency engine fires the onAddressChecked callback.
 */
export type CurrencyEngineChangedSyncRatio = {
  type: 'CURRENCY_ENGINE_CHANGED_SYNC_RATIO',
  payload: {
    ratio: number,
    walletId: string
  }
}

/**
 * Called when a currency engine fires the onTransactionsChanged callback.
 */
export type CurrencyEngineChangedTxs = {
  type: 'CURRENCY_ENGINE_CHANGED_TXS',
  payload: {
    txs: Array<any>,
    walletId: string,
    txidHashes: any
  }
}

/**
 * Called when a currency engine is wiped out.
 */
export type CurrencyEngineCleared = {
  type: 'CURRENCY_ENGINE_CLEARED',
  payload: {
    walletId: string
  }
}

/**
 * Called when a currency engine dies on startup.
 */
export type CurrencyEngineFailed = {
  type: 'CURRENCY_ENGINE_FAILED',
  payload: {
    error: Error,
    walletId: string
  }
}

/**
 * Fired when the currency plugins failed to load.
 */
export type CurrencyPluginsFailed = {
  type: 'CURRENCY_PLUGINS_FAILED',
  payload: Error
}

/**
 * Fired when the currency plugins load successfully.
 */
export type CurrencyPluginsLoaded = {
  type: 'CURRENCY_PLUGINS_LOADED',
  payload: Array<EdgeCurrencyInfo>
}

/**
 * Called when a currency wallet receives a new name.
 */
export type CurrencyWalletFiatChanged = {
  type: 'CURRENCY_WALLET_FIAT_CHANGED',
  payload: {
    fiatCurrencyCode: string,
    walletId: string
  }
}

/**
 * Called when a currency wallet's individual transaction metadata has changed.
 */
export type CurrencyWalletFileChanged = {
  type: 'CURRENCY_WALLET_FILE_CHANGED',
  payload: {
    creationDate: number,
    fileName: string,
    json: Object,
    txid: string,
    txidHash: string,
    walletId: string
  }
}

/**
 * Called when a currency wallet's files have been loaded from disk.
 */
export type CurrencyWalletFilesLoaded = {
  type: 'CURRENCY_WALLET_FILES_LOADED',
  payload: {
    files: TxFileJsons,
    walletId: string
  }
}

/**
 * Called when a currency wallet's file names have been loaded from disk.
 */
export type CurrencyWalletFileNamesLoaded = {
  type: 'CURRENCY_WALLET_FILE_NAMES_LOADED',
  payload: {
    txFileNames: TxFileNames,
    walletId: string
  }
}

/**
 * Called when a currency wallet receives a new name.
 */
export type CurrencyWalletNameChanged = {
  type: 'CURRENCY_WALLET_NAME_CHANGED',
  payload: {
    name: string | null,
    walletId: string
  }
}

/**
 * Fired when we fetch exchange pairs from some server.
 */
export type ExchangePairsFetched = {
  type: 'EXCHANGE_PAIRS_FETCHED',
  payload: Array<ExchangePair>
}

/**
 * Initializes the redux store on context creation.
 */
export type InitAction = {
  type: 'INIT',
  payload: {
    apiKey: string,
    appId: string,
    authServer: string
  }
}

/**
 * Fires when a user logs in.
 */
export type LoginAction = {
  type: 'LOGIN',
  payload: {
    appId: string,
    callbacks: EdgeAccountCallbacks,
    loginKey: Uint8Array,
    loginType: string,
    rootLogin: boolean,
    username: string
  }
}

/**
 * Fires when we delete login data from disk.
 */
export type LoginStashDeleted = {
  type: 'LOGIN_STASH_DELETED',
  payload: string // username
}

/**
 * Fires when we load the login data from disk.
 */
export type LoginStashesLoaded = {
  type: 'LOGIN_STASHES_LOADED',
  payload: { [filename: string]: Object }
}

/**
 * Fires when we write a login stash to disk.
 */
export type LoginStashSaved = {
  type: 'LOGIN_STASH_SAVED',
  payload: LoginStash
}

/**
 * Fires when a user logs out.
 */
export type LogoutAction = {
  type: 'LOGOUT',
  payload: { accountId: string }
}

/**
 * Fires when we load plugin settings from disk.
 */
export type NewCurrencyPluginSettingsAction = {
  type: 'NEW_CURRENCY_PLUGIN_SETTINGS',
  payload: PluginSettings
}

/**
 * Fires when a storage wallet has been loaded.
 */
export type StorageWalletAdded = {
  type: 'STORAGE_WALLET_ADDED',
  payload: {
    id: string,
    initialState: StorageWalletState
  }
}

/**
 * Fires when a repo has been synced.
 */
export type StorageWalletSynced = {
  type: 'STORAGE_WALLET_SYNCED',
  payload: {
    id: string,
    changes: Array<string>,
    status: StorageWalletStatus
  }
}

export type RootAction =
  | AccountChangedWalletStates
  | AccountKeysLoadedAction
  | AccountLoadFailed
  | AddedCustomToken
  | ChangedCurrencyPluginSettingAction
  | CurrencyEngineChangedBalance
  | CurrencyEngineChangedHeight
  | CurrencyEngineChangedSeeds
  | CurrencyEngineChangedSyncRatio
  | CurrencyEngineChangedTxs
  | CurrencyEngineCleared
  | CurrencyEngineFailed
  | CurrencyPluginsFailed
  | CurrencyPluginsLoaded
  | CurrencyWalletFiatChanged
  | CurrencyWalletFileChanged
  | CurrencyWalletFileNamesLoaded
  | CurrencyWalletFilesLoaded
  | CurrencyWalletNameChanged
  | ExchangePairsFetched
  | InitAction
  | LoginAction
  | LoginStashDeleted
  | LoginStashesLoaded
  | LoginStashSaved
  | LogoutAction
  | NewCurrencyPluginSettingsAction
  | StorageWalletAdded
  | StorageWalletSynced

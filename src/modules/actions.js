// @flow

import type {
  EdgeAccountCallbacks,
  EdgeCurrencyInfo,
  EdgeTokenInfo,
  EdgeWalletInfo
} from '../edge-core-index.js'

/**
 * The account fires this when it loads its keys from disk.
 */
export interface AccountKeysLoadedAction {
  type: 'ACCOUNT_KEYS_LOADED';
  payload: {
    activeLoginId: string,
    walletInfos: Array<EdgeWalletInfo>
  };
}

/**
 * Somebody just added a custom token type to the wallet.
 */
export interface AddedCustomToken {
  type: 'ADDED_CUSTOM_TOKEN';
  payload: EdgeTokenInfo;
}

/**
 * Called when a currency engine fires the onTransactionsChanged callback.
 */
export interface CurrencyEngineChangedTxs {
  type: 'CURRENCY_ENGINE_CHANGED_TXS';
  payload: {
    txs: Array<any>,
    filesMetadata: any,
    walletId: string
  };
}

/**
 * Called when a currency engine is fully synced
 */
export interface CurrencyEngineSynced {
  type: 'CURRENCY_ENGINE_PROGGRESS_RATIO';
  payload: { walletId: string, ratio: number };
}

/**
 * Called when a currency engine is wiped out.
 */
export interface CurrencyEngineCleared {
  type: 'CURRENCY_ENGINE_CLEARED';
  payload: {
    walletId: string
  };
}

/**
 * Called when a currency engine dies on startup.
 */
export interface CurrencyEngineFailed {
  type: 'CURRENCY_ENGINE_FAILED';
  payload: {
    error: Error,
    walletId: string
  };
}

/**
 * Fired when the currency plugins failed to load.
 */
export interface CurrencyPluginsFailed {
  type: 'CURRENCY_PLUGINS_FAILED';
  payload: Error;
}

/**
 * Fired when the currency plugins load successfully.
 */
export interface CurrencyPluginsLoaded {
  type: 'CURRENCY_PLUGINS_LOADED';
  payload: Array<EdgeCurrencyInfo>;
}

/**
 * Called when a currency wallet receives a new name.
 */
export interface CurrencyWalletFiatChanged {
  type: 'CURRENCY_WALLET_FIAT_CHANGED';
  payload: {
    fiatCurrencyCode: string,
    walletId: string
  };
}

/**
 * Called when a currency wallet's individual transaction metadata has changed.
 */
export interface CurrencyWalletFileChanged {
  type: 'CURRENCY_WALLET_FILE_CHANGED';
  payload: {
    file: any,
    fileName: string,
    fileMetadata: any,
    walletId: string
  };
}

/**
 * Called when a currency wallet's files have been loaded from disk.
 */
export interface CurrencyWalletFilesLoaded {
  type: 'CURRENCY_WALLET_FILES_LOADED';
  payload: {
    files: any,
    walletId: string
  };
}

/**
 * Called when a currency wallet's file metadata have been loaded from disk.
 */
export interface CurrencyWalletFilesMetadataLoaded {
  type: 'CURRENCY_WALLET_FILES_METADATA_LOADED';
  payload: {
    filesMetadata: any,
    walletId: string
  };
}

/**
 * Called when a currency wallet receives a new name.
 */
export interface CurrencyWalletNameChanged {
  type: 'CURRENCY_WALLET_NAME_CHANGED';
  payload: {
    name: string | null,
    walletId: string
  };
}

/**
 * Initializes the redux store on context creation.
 */
export interface InitAction {
  type: 'INIT';
  payload: {
    apiKey: string | void,
    appId: string | void,
    authServer: string | void
  };
}

/**
 * Fires when a user logs in.
 */
export interface LoginAction {
  type: 'LOGIN';
  payload: {
    appId: string,
    callbacks: EdgeAccountCallbacks,
    loginKey: Uint8Array,
    username: string
  };
}

/**
 * Fires when a user logs out.
 */
export interface LogoutAction {
  type: 'LOGOUT';
  payload: { activeLoginId: string };
}

/**
 * Fires when a repo has been synced.
 */
export interface RepoSynced {
  type: 'REPO_SYNCED';
  payload: {
    changes: Array<string>,
    status: {
      lastHash: string,
      lastSync: number
    }
  };
}

export type RootAction =
  | AccountKeysLoadedAction
  | AddedCustomToken
  | CurrencyEngineChangedTxs
  | CurrencyEngineSynced
  | CurrencyEngineCleared
  | CurrencyEngineFailed
  | CurrencyPluginsFailed
  | CurrencyPluginsLoaded
  | CurrencyWalletFiatChanged
  | CurrencyWalletFileChanged
  | CurrencyWalletFilesLoaded
  | CurrencyWalletFilesMetadataLoaded
  | CurrencyWalletNameChanged
  | InitAction
  | LoginAction
  | LogoutAction
  | RepoSynced

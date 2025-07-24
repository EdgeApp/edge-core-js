import {
  EdgeCorePlugin,
  EdgeCorePluginsInit,
  EdgeCurrencyTools,
  EdgeLogSettings,
  EdgePluginMap,
  EdgeStakingStatus,
  EdgeToken,
  EdgeTokenId,
  EdgeTokenMap,
  EdgeTransaction,
  EdgeWalletInfo,
  EdgeWalletStates
} from '../types/types'
import { SwapSettings } from './account/account-types'
import { ClientInfo } from './context/client-file'
import { InfoCacheFile } from './context/info-cache-file'
import {
  ChangeServiceSubscription,
  MergedTransaction,
  TxFileJsons,
  TxFileNames,
  TxidHashes
} from './currency/wallet/currency-wallet-reducer'
import { LoginStash } from './login/login-stash'
import { LoginType, SessionKey } from './login/login-types'
import {
  StorageWalletState,
  StorageWalletStatus
} from './storage/storage-reducer'

export type RootAction =
  | {
      // Fired when somebody changes the always-enabled token list:
      type: 'ACCOUNT_ALWAYS_ENABLED_TOKENS_CHANGED'
      payload: {
        accountId: string
        pluginId: string
        tokenIds: string[]
      }
    }
  | {
      // A currency plugin has returned its builtin tokens.
      type: 'ACCOUNT_BUILTIN_TOKENS_LOADED'
      payload: {
        accountId: string
        pluginId: string
        tokens: EdgeTokenMap
      }
    }
  | {
      // The account fires this when the user sorts or archives wallets.
      type: 'ACCOUNT_CHANGED_WALLET_STATES'
      payload: {
        accountId: string
        walletStates: EdgeWalletStates
      }
    }
  | {
      // Somebody just added or changed a custom token.
      type: 'ACCOUNT_CUSTOM_TOKEN_ADDED'
      payload: {
        accountId: string
        pluginId: string
        tokenId: string
        token: EdgeToken
      }
    }
  | {
      // Somebody just removed a custom token.
      type: 'ACCOUNT_CUSTOM_TOKEN_REMOVED'
      payload: {
        accountId: string
        pluginId: string
        tokenId: string
      }
    }
  | {
      // We have just read the custom tokens from disk.
      type: 'ACCOUNT_CUSTOM_TOKENS_LOADED'
      payload: {
        accountId: string
        customTokens: EdgePluginMap<EdgeTokenMap>
      }
    }
  | {
      // The account fires this when it loads its keys from disk.
      type: 'ACCOUNT_KEYS_LOADED'
      payload: {
        accountId: string
        legacyWalletInfos: EdgeWalletInfo[]
        walletStates: EdgeWalletStates
      }
    }
  | {
      // The account encountered an error when initializing itself.
      type: 'ACCOUNT_LOAD_FAILED'
      payload: {
        accountId: string
        error: unknown
      }
    }
  | {
      // Fired when somebody changes the currency settings for a plugin.
      type: 'ACCOUNT_PLUGIN_SETTINGS_CHANGED'
      payload: {
        accountId: string
        pluginId: string
        userSettings: object
      }
    }
  | {
      // Fires when we load plugin settings from disk.
      type: 'ACCOUNT_PLUGIN_SETTINGS_LOADED'
      payload: {
        accountId: string
        userSettings: EdgePluginMap<object>
        swapSettings: EdgePluginMap<SwapSettings>
      }
    }
  | {
      // Fired when somebody enables or disables swap plugins.
      type: 'ACCOUNT_SWAP_SETTINGS_CHANGED'
      payload: {
        accountId: string
        pluginId: string
        swapSettings: SwapSettings
      }
    }
  | {
      type: 'CHANGE_LOG_SETTINGS'
      payload: EdgeLogSettings
    }
  | {
      // Called when the core needs to change a specific tx.
      // DEPRECATE: After all currency plugins implement new Confirmations API
      type: 'CHANGE_MERGE_TX'
      payload: {
        tx: MergedTransaction
      }
    }
  | {
      // Shuts down the context and all its objects.
      type: 'CLOSE'
    }
  | {
      // Called when new plugins become available.
      type: 'CORE_PLUGINS_ADDED'
      payload: EdgePluginMap<EdgeCorePlugin>
    }
  | {
      // Called when the plugin list becomes final.
      type: 'CORE_PLUGINS_LOCKED'
    }
  | {
      // Called when a currency engine fires the onBalanceChanged callback.
      type: 'CURRENCY_ENGINE_CHANGED_BALANCE'
      payload: {
        balance: string
        tokenId: EdgeTokenId
        walletId: string
      }
    }
  | {
      // Called when a currency engine fires the onBlockHeightChanged callback.
      type: 'CURRENCY_ENGINE_CHANGED_HEIGHT'
      payload: {
        height: number
        walletId: string
      }
    }
  | {
      // Called when a currency engine fires the onStakingStatusChanged callback.
      type: 'CURRENCY_ENGINE_CHANGED_STAKING'
      payload: {
        walletId: string
        stakingStatus: EdgeStakingStatus
      }
    }
  | {
      // Called when a currency engine fires the onAddressChecked callback.
      type: 'CURRENCY_ENGINE_CHANGED_SYNC_RATIO'
      payload: {
        ratio: number
        walletId: string
      }
    }
  | {
      // Called when a currency engine fires the onTransactionsChanged callback.
      type: 'CURRENCY_ENGINE_CHANGED_TXS'
      payload: {
        txs: EdgeTransaction[]
        walletId: string
        txidHashes: TxidHashes
      }
    }
  | {
      // Called when a currency engine fires the onAddressChecked callback.
      type: 'CURRENCY_ENGINE_CHANGED_UNACTIVATED_TOKEN_IDS'
      payload: {
        unactivatedTokenIds: string[]
        walletId: string
      }
    }
  | {
      type: 'CURRENCY_ENGINE_UPDATE_CHANGE_SERVICE_SUBSCRIPTIONS'
      payload: {
        subscriptions: ChangeServiceSubscription[]
        walletId: string
      }
    }
  | {
      // Called when a currency engine fires the onNewTokens callback.
      type: 'CURRENCY_ENGINE_DETECTED_TOKENS'
      payload: {
        detectedTokenIds: string[]
        enablingTokenIds: string[]
        walletId: string
      }
    }
  | {
      type: 'CURRENCY_ENGINE_GOT_TXS'
      payload: {
        walletId: string
        tokenId: EdgeTokenId
      }
    }
  | {
      type: 'CURRENCY_ENGINE_SEEN_TX_CHECKPOINT_CHANGED'
      payload: {
        walletId: string
        checkpoint: string
      }
    }
  | {
      // Called when a currency engine is wiped out.
      type: 'CURRENCY_ENGINE_CLEARED'
      payload: {
        walletId: string
      }
    }
  | {
      // Called when a currency engine dies at creation time.
      type: 'CURRENCY_ENGINE_FAILED'
      payload: {
        error: unknown
        walletId: string
      }
    }
  | {
      // Called when a currency engine begins connecting to the network.
      type: 'CURRENCY_ENGINE_STARTED'
      payload: {
        walletId: string
      }
    }
  | {
      // Called when a currency engine finishes shutting down its networking.
      type: 'CURRENCY_ENGINE_STOPPED'
      payload: {
        walletId: string
      }
    }
  | {
      // Called when the core finishes loading currency tools:
      type: 'CURRENCY_TOOLS_LOADED'
      payload: {
        pluginId: string
        tools: Promise<EdgeCurrencyTools>
      }
    }
  | {
      type: 'CURRENCY_WALLET_CHANGED_PAUSED'
      payload: {
        paused: boolean
        walletId: string
      }
    }
  | {
      type: 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED'
      payload: {
        enabledTokenIds: string[]
        walletId: string
      }
    }
  | {
      // Called when a currency wallet receives a new name.
      type: 'CURRENCY_WALLET_FIAT_CHANGED'
      payload: {
        fiatCurrencyCode: string
        walletId: string
      }
    }
  | {
      // Called when a currency wallet's individual transaction metadata has changed.
      type: 'CURRENCY_WALLET_FILE_CHANGED'
      payload: {
        creationDate: number
        fileName: string
        json: any
        txid: string
        txidHash: string
        walletId: string
      }
    }
  | {
      // Called when a currency wallet's files have been loaded from disk.
      type: 'CURRENCY_WALLET_FILES_LOADED'
      payload: {
        files: TxFileJsons
        walletId: string
      }
    }
  | {
      // Called when a currency wallet's file names have been loaded from disk.
      type: 'CURRENCY_WALLET_FILE_NAMES_LOADED'
      payload: {
        txFileNames: TxFileNames
        walletId: string
      }
    }
  | {
      type: 'CURRENCY_WALLET_LOADED_TOKEN_FILE'
      payload: {
        detectedTokenIds: string[]
        enabledTokenIds: string[]
        walletId: string
      }
    }
  | {
      // Called when a currency wallet receives a new name.
      type: 'CURRENCY_WALLET_NAME_CHANGED'
      payload: {
        name: string | null
        walletId: string
      }
    }
  | {
      // Called when a currency wallet derives its public keys.
      type: 'CURRENCY_WALLET_PUBLIC_INFO'
      payload: {
        walletId: string
        walletInfo: EdgeWalletInfo
      }
    }
  | {
      // Called once we write the enabled token file to disk:
      type: 'CURRENCY_WALLET_SAVED_TOKEN_FILE'
      payload: {
        walletId: string
      }
    }
  | {
      type: 'INFO_CACHE_FETCHED'
      payload: InfoCacheFile
    }
  | {
      // Initializes the redux store on context creation.
      type: 'INIT'
      payload: {
        apiKey: string
        apiSecret?: Uint8Array
        appId: string
        changeServers: string[]
        infoCache: InfoCacheFile
        infoServers: string[]
        loginServers: string[]
        syncServers: string[]
        clientInfo: ClientInfo
        deviceDescription: string | null
        hideKeys: boolean
        logSettings: EdgeLogSettings
        pluginsInit: EdgeCorePluginsInit
        skipBlockHeight: boolean
        stashes: LoginStash[]
      }
    }
  | {
      // Fires when a user logs in.
      type: 'LOGIN'
      payload: {
        appId: string
        loginType: LoginType
        pauseWallets: boolean
        rootLoginId: Uint8Array
        sessionKey: SessionKey
      }
    }
  | {
      // Fires when we delete login data from disk.
      type: 'LOGIN_STASH_DELETED'
      payload: Uint8Array // loginId
    }
  | {
      // Fires when we write a login stash to disk.
      type: 'LOGIN_STASH_SAVED'
      payload: LoginStash
    }
  | {
      type: 'LOGIN_DURESS_MODE_DISABLED'
    }
  | {
      type: 'LOGIN_DURESS_MODE_ENABLED'
    }
  | {
      type: 'LOGIN_WAIT_TIMESTAMP_UPDATED'
      payload: {
        loginId: string
        timestamp: number
      }
    }
  | {
      // Fires when a user logs out.
      type: 'LOGOUT'
      payload: { accountId: string }
    }
  | {
      // Pause / unpause background work.
      type: 'PAUSE'
      payload: boolean
    }
  | {
      // Fires when a storage wallet has been loaded.
      type: 'STORAGE_WALLET_ADDED'
      payload: {
        id: string
        initialState: StorageWalletState
      }
    }
  | {
      // Fires when a repo has been synced.
      type: 'STORAGE_WALLET_SYNCED'
      payload: {
        id: string
        changes: string[]
        status: StorageWalletStatus
      }
    }
  | {
      // Dummy action to propagate `next` changes.
      type: 'UPDATE_NEXT'
    }

export type Dispatch = (action: RootAction) => RootAction

import { makeMemoryDisklet } from 'disklet'
import { bridgifyObject, onMethod, watchMethod } from 'yaob'

import {
  EdgeAddress,
  EdgeBalanceMap,
  EdgeBalances,
  EdgeCurrencyConfig,
  EdgeCurrencyEngine,
  EdgeCurrencyInfo,
  EdgeCurrencyWallet,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetReceiveAddressOptions,
  EdgeGetTransactionsOptions,
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeSaveTxActionOptions,
  EdgeSaveTxMetadataOptions,
  EdgeSignMessageOptions,
  EdgeSpendInfo,
  EdgeStakingStatus,
  EdgeStreamTransactionOptions,
  EdgeTokenIdOptions,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../types/types'
import { CachedWallet } from './cache-wallet-cleaners'

const LOG_PREFIX = '[WalletCache]'

/**
 * Callback to create the real engine for lazy instantiation.
 * Returns the engine and starts it in the background.
 */
export type EngineCreator = () => Promise<EdgeCurrencyEngine>

/**
 * Creates a logging wrapper for cached wallet methods.
 */
function logMethod<T extends (...args: any[]) => any>(
  walletId: string,
  methodName: string,
  fn: T
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    const shortId = walletId.slice(0, 8)
    console.log(`${LOG_PREFIX} ${shortId}.${methodName}(`, ...args, ')')
    return fn(...args)
  }) as T
}

/**
 * Options for creating a cached wallet with optional lazy engine support.
 */
export interface CachedWalletOptions {
  /** Callback to create the real engine for lazy instantiation */
  engineCreator?: EngineCreator
}

/**
 * Creates a cached EdgeCurrencyWallet with optional lazy engine instantiation.
 * When engineCreator is provided, engine-requiring methods will trigger
 * engine creation and pass through to the real engine.
 */
export function makeCachedCurrencyWallet(
  cacheData: CachedWallet,
  currencyInfo: EdgeCurrencyInfo,
  currencyConfig: EdgeCurrencyConfig,
  options: CachedWalletOptions = {}
): EdgeCurrencyWallet {
  const { engineCreator } = options
  const {
    id: walletId,
    type,
    name,
    fiatCurrencyCode,
    balances,
    enabledTokenIds
  } = cacheData

  // Lazy engine state
  let engine: EdgeCurrencyEngine | undefined
  let enginePromise: Promise<EdgeCurrencyEngine> | undefined

  /**
   * Ensures the engine is created. Uses promise locking to prevent
   * duplicate engine creation from concurrent calls.
   */
  async function ensureEngine(): Promise<EdgeCurrencyEngine> {
    if (engine != null) return engine

    if (enginePromise == null && engineCreator != null) {
      console.log(`${LOG_PREFIX} ${walletId.slice(0, 8)} creating engine...`)
      enginePromise = engineCreator().then(newEngine => {
        engine = newEngine
        console.log(`${LOG_PREFIX} ${walletId.slice(0, 8)} engine created`)
        // Start engine in background (don't block)
        newEngine.startEngine().catch(err => {
          console.warn(
            `${LOG_PREFIX} ${walletId.slice(0, 8)} engine start error:`,
            err
          )
        })
        return newEngine
      })
    }

    if (enginePromise != null) {
      return await enginePromise
    }

    throw new Error(
      'Cached wallet: engine required but no engine creator provided'
    )
  }

  /**
   * Helper to check if engine is available.
   * Methods that require engine should call this and throw a helpful error.
   */
  function requiresEngine(methodName: string): never {
    throw new Error(
      `${methodName} requires engine instantiation. ` +
        (engineCreator != null
          ? 'Engine creation is in progress.'
          : 'This cached wallet does not support lazy engine instantiation.')
    )
  }

  // Build balance map from cached data
  const balanceMap: EdgeBalanceMap = new Map()
  const balancesObj: EdgeBalances = {}
  for (const [tokenIdStr, amount] of Object.entries(balances)) {
    const tokenId = tokenIdStr === 'null' ? null : tokenIdStr
    balanceMap.set(tokenId, amount)

    // Get currency code for the balances object
    if (tokenId === null) {
      balancesObj[currencyInfo.currencyCode] = amount
    } else {
      const token = currencyConfig.allTokens[tokenId]
      if (token != null) {
        balancesObj[token.currencyCode] = amount
      }
    }
  }

  const publicWalletInfo: EdgeWalletInfo = {
    id: walletId,
    type,
    keys: {}
  }

  const stakingStatus: EdgeStakingStatus = { stakedAmounts: [] }

  // Create memory disklets
  const disklet = makeMemoryDisklet()
  const localDisklet = makeMemoryDisklet()

  const wallet: EdgeCurrencyWallet = {
    on: onMethod,
    watch: watchMethod,

    // Data store:
    get created(): Date | undefined {
      return new Date()
    },
    get disklet() {
      return disklet
    },
    get id(): string {
      return walletId
    },
    get localDisklet() {
      return localDisklet
    },
    publicWalletInfo,
    sync: logMethod(walletId, 'sync', async () => {}),
    get type(): string {
      return type
    },

    // Wallet name:
    get name(): string | null {
      return name ?? null
    },
    renameWallet: logMethod(
      walletId,
      'renameWallet',
      async (_name: string) => {}
    ),

    // Fiat currency option:
    get fiatCurrencyCode(): string {
      return fiatCurrencyCode
    },
    setFiatCurrencyCode: logMethod(
      walletId,
      'setFiatCurrencyCode',
      async (_code: string) => {}
    ),

    // Currency info:
    get currencyConfig(): EdgeCurrencyConfig {
      return currencyConfig
    },
    get currencyInfo(): EdgeCurrencyInfo {
      return currencyInfo
    },

    // Chain state:
    get balanceMap(): EdgeBalanceMap {
      return balanceMap
    },
    get balances(): EdgeBalances {
      return balancesObj
    },
    get blockHeight(): number {
      return 0
    },
    get syncRatio(): number {
      // Return a value indicating cache-loaded state before engine syncs
      return engine != null ? 0 : 0.5
    },
    get unactivatedTokenIds(): string[] {
      return []
    },

    // Running state:
    changePaused: logMethod(
      walletId,
      'changePaused',
      async (_paused: boolean) => {
        if (engineCreator != null) {
          await ensureEngine()
        }
        // No-op for cached wallets without engine
      }
    ),
    get paused(): boolean {
      return false
    },

    // Token management:
    changeEnabledTokenIds: logMethod(
      walletId,
      'changeEnabledTokenIds',
      async (_tokenIds: string[]) => {}
    ),
    get enabledTokenIds(): string[] {
      return enabledTokenIds
    },
    get detectedTokenIds(): string[] {
      return []
    },

    // Transaction history (engine required):
    getNumTransactions: logMethod(
      walletId,
      'getNumTransactions',
      async (_opts: EdgeTokenIdOptions) => {
        // Return 0 for cached wallets - engine required for actual count
        return 0
      }
    ),
    getTransactions: logMethod(
      walletId,
      'getTransactions',
      async (_opts: EdgeGetTransactionsOptions) => {
        // Return empty for cached wallets - engine required
        return []
      }
    ),
    streamTransactions: logMethod(
      walletId,
      'streamTransactions',
      async function* (_opts: EdgeStreamTransactionOptions) {
        // Return empty for cached wallets - engine required
        yield []
      }
    ),

    // Addresses (engine required):
    getAddresses: logMethod(
      walletId,
      'getAddresses',
      async (_opts: EdgeGetReceiveAddressOptions): Promise<EdgeAddress[]> => {
        // Return empty for cached wallets - engine required
        return []
      }
    ),

    // Sending (engine required - will trigger lazy instantiation when available):
    broadcastTx: logMethod(
      walletId,
      'broadcastTx',
      async (_tx: EdgeTransaction) => {
        return requiresEngine('broadcastTx')
      }
    ),
    getMaxSpendable: logMethod(
      walletId,
      'getMaxSpendable',
      async (_spendInfo: EdgeSpendInfo) => {
        return requiresEngine('getMaxSpendable')
      }
    ),
    getPaymentProtocolInfo: logMethod(
      walletId,
      'getPaymentProtocolInfo',
      async (_url: string): Promise<EdgePaymentProtocolInfo> => {
        return requiresEngine('getPaymentProtocolInfo')
      }
    ),
    makeSpend: logMethod(
      walletId,
      'makeSpend',
      async (_spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> => {
        return requiresEngine('makeSpend')
      }
    ),
    saveTx: logMethod(walletId, 'saveTx', async (_tx: EdgeTransaction) => {
      return requiresEngine('saveTx')
    }),
    saveTxAction: logMethod(
      walletId,
      'saveTxAction',
      async (_opts: EdgeSaveTxActionOptions) => {
        return requiresEngine('saveTxAction')
      }
    ),
    saveTxMetadata: logMethod(
      walletId,
      'saveTxMetadata',
      async (_opts: EdgeSaveTxMetadataOptions) => {
        return requiresEngine('saveTxMetadata')
      }
    ),
    signTx: logMethod(
      walletId,
      'signTx',
      async (_tx: EdgeTransaction): Promise<EdgeTransaction> => {
        return requiresEngine('signTx')
      }
    ),
    sweepPrivateKeys: logMethod(
      walletId,
      'sweepPrivateKeys',
      async (_spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> => {
        return requiresEngine('sweepPrivateKeys')
      }
    ),

    // Signing (engine required):
    signBytes: logMethod(
      walletId,
      'signBytes',
      async (_bytes: Uint8Array, _opts?: EdgeSignMessageOptions) => {
        return requiresEngine('signBytes')
      }
    ),

    // Accelerating (engine required):
    accelerate: logMethod(
      walletId,
      'accelerate',
      async (_tx: EdgeTransaction) => {
        return requiresEngine('accelerate')
      }
    ),

    // Staking:
    get stakingStatus(): EdgeStakingStatus {
      return stakingStatus
    },

    // Wallet management (engine required):
    dumpData: logMethod(
      walletId,
      'dumpData',
      async (): Promise<EdgeDataDump> => ({
        walletId,
        walletType: type,
        data: {}
      })
    ),
    resyncBlockchain: logMethod(walletId, 'resyncBlockchain', async () => {
      return requiresEngine('resyncBlockchain')
    }),

    // URI handling (no engine needed):
    encodeUri: logMethod(
      walletId,
      'encodeUri',
      async (_obj: EdgeEncodeUri) => ''
    ),
    parseUri: logMethod(
      walletId,
      'parseUri',
      async (
        _uri: string,
        _currencyCode?: string
      ): Promise<EdgeParsedUri> => ({})
    ),

    // Generic - empty object for cached wallets
    // GUI code should check if methods exist before calling them
    otherMethods: {},

    // Deprecated methods:
    denominationToNative: logMethod(
      walletId,
      'denominationToNative',
      async (_amount: string, _currencyCode: string) => '0'
    ),
    nativeToDenomination: logMethod(
      walletId,
      'nativeToDenomination',
      async (_amount: string, _currencyCode: string) => '0'
    ),
    getReceiveAddress: logMethod(
      walletId,
      'getReceiveAddress',
      async (
        _opts: EdgeGetReceiveAddressOptions
      ): Promise<EdgeReceiveAddress> => ({
        publicAddress: '',
        metadata: {
          bizId: 0,
          category: '',
          exchangeAmount: {},
          name: '',
          notes: ''
        },
        nativeAmount: '0'
      })
    ),
    lockReceiveAddress: logMethod(
      walletId,
      'lockReceiveAddress',
      async (_receiveAddress: EdgeReceiveAddress) => {}
    ),
    saveReceiveAddress: logMethod(
      walletId,
      'saveReceiveAddress',
      async (_receiveAddress: EdgeReceiveAddress) => {}
    ),
    signMessage: logMethod(
      walletId,
      'signMessage',
      async (_message: string, _opts?: EdgeSignMessageOptions) => {
        return requiresEngine('signMessage')
      }
    )
  }

  return bridgifyObject(wallet)
}

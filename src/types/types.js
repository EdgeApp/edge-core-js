// @flow

import { type Disklet } from 'disklet'
import {
  type FetchFunction,
  type FetchHeaders,
  type FetchOptions,
  type FetchResponse
} from 'serverlet'
import { type Subscriber } from 'yaob'

export * from './error.js'

// ---------------------------------------------------------------------
// helper types
// ---------------------------------------------------------------------

/** A JSON object (as opposed to an array or primitive). */
export type JsonObject = {
  [name: string]: any // TODO: this needs to become `mixed`
}

/** A collection of unknown extra methods exposed by a plugin. */
export type EdgeOtherMethods = {
  +[name: string]: any
}

/** We frequently index things by pluginId, so provide a helper. */
export type EdgePluginMap<Value> = {
  [pluginId: string]: Value
}

/** Same as the TypeScript `Partial` utility. */
export type Partial<T> = $Rest<T, { ... }> // @ts-delete

/** Same as the TypeScript `ReturnType` utility. */
type ReturnHelper = <R>(f: (...a: any[]) => R) => R // @ts-delete
export type ReturnType<F> = $Call<ReturnHelper, F> // @ts-delete

// ---------------------------------------------------------------------
// io types
// ---------------------------------------------------------------------

// Node.js randomBytes function:
export type EdgeRandomFunction = (bytes: number) => Uint8Array

// The scrypt function Edge expects:
export type EdgeScryptFunction = (
  data: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  dklen: number
) => Promise<Uint8Array>

// The subset of the fetch function Edge expects:
export type EdgeFetchOptions = FetchOptions
export type EdgeFetchHeaders = FetchHeaders
export type EdgeFetchResponse = FetchResponse
export type EdgeFetchFunction = FetchFunction

/**
 * Access to platform-specific resources.
 * The core never talks to the outside world on its own,
 * but always goes through this object.
 */
export type EdgeIo = {
  // Crypto:
  +random: EdgeRandomFunction,
  +scrypt: EdgeScryptFunction,

  // Local io:
  +disklet: Disklet,
  +fetch: EdgeFetchFunction,

  // This is only present if the platform has some way to avoid CORS:
  +fetchCors?: EdgeFetchFunction
}

// logging -------------------------------------------------------------

export type EdgeLogMethod = (...args: any[]) => void

/**
 * Logs a message.
 *
 * Call `log(message)` for normal information messages,
 * or `log.warn(message)` / `log.error(message)` for something more severe.
 * To record crash information, use `log.crash(error, json)` for errors,
 * and `log.breadcrumb(message, json)` for data leading up to crashes.
 */
export type EdgeLog = EdgeLogMethod & {
  // Crash logging:
  +breadcrumb: (message: string, metadata: JsonObject) => void,
  +crash: (error: mixed, metadata: JsonObject) => void,

  // Message logging:
  +warn: EdgeLogMethod,
  +error: EdgeLogMethod
}

export type EdgeLogType = 'info' | 'warn' | 'error'

export type EdgeLogSettings = {
  sources: { [pluginId: string]: EdgeLogType },
  defaultLogLevel: EdgeLogType | 'silent'
}

/**
 * The EdgeLog function stringifies its arguments and adds
 * some extra information to form this event type.
 */
export type EdgeLogEvent = {
  message: string,
  source: string,
  time: Date,
  type: EdgeLogType
}

export type EdgeBreadcrumbEvent = {
  message: string,
  metadata: JsonObject,
  source: string,
  time: Date
}

export type EdgeCrashEvent = {
  error: mixed,
  metadata: JsonObject,
  source: string,
  time: Date
}

/**
 * Receives crash reports.
 * The app should implement this interface and pass it to the context.
 */
export type EdgeCrashReporter = {
  +logBreadcrumb: (breadcrumb: EdgeBreadcrumbEvent) => void,
  +logCrash: (crash: EdgeCrashEvent) => void
}

/**
 * Receives log messages.
 * The app should implement this function and pass it to the context.
 */
export type EdgeOnLog = (event: EdgeLogEvent) => void

// plugins -------------------------------------------------------------

/**
 * On React Native, each plugin can provide a bridge to whatever native
 * io it needs.
 */
export type EdgeNativeIo = { [packageName: string]: EdgeOtherMethods }

/**
 * All core plugins receive these options at creation time.
 */
export type EdgeCorePluginOptions = {
  // Load-time options (like API keys) passed into the context:
  initOptions: JsonObject,

  // Access to the world outside the plugin:
  io: EdgeIo,
  log: EdgeLog, // Plugin-scoped logging
  nativeIo: EdgeNativeIo, // Only filled in on React Native
  pluginDisklet: Disklet // Plugin-scoped local storage
}

// ---------------------------------------------------------------------
// key types
// ---------------------------------------------------------------------

export type EdgeWalletInfo = {
  id: string,
  type: string,
  keys: JsonObject
}

export type EdgeWalletInfoFull = EdgeWalletInfo & {
  appIds: string[],
  archived: boolean,
  deleted: boolean,
  hidden: boolean,
  sortIndex: number
}

export type EdgeWalletState = {
  archived?: boolean,
  deleted?: boolean,
  hidden?: boolean,
  sortIndex?: number
}

export type EdgeWalletStates = {
  [walletId: string]: EdgeWalletState
}

// ---------------------------------------------------------------------
// currency types
// ---------------------------------------------------------------------

// token info ----------------------------------------------------------

export type EdgeDenomination = {
  // Multiply a display amount by this number to get the native amount.
  // BTC would use "100000000", for instance:
  multiplier: string,

  // A display name for this denomination, like "BTC", "bits", or "sats":
  name: string,

  // A prefix to add to the formatted number, like "₿", "ƀ", or "s":
  symbol?: string
}

/**
 * Information used to display a token or currency to the user.
 */
export type EdgeToken = {
  // The short code used on exchanges, such as "BTC":
  currencyCode: string,

  // How many decimal places to shift the native amount.
  // The first item in this array is always the default for exchanges:
  denominations: EdgeDenomination[],

  // The full marketing name, such as "Bitcoin":
  displayName: string,

  // Each currency plugin decides what this contains,
  // such as a contract address.
  // The primary currency for a network, such as BTC or ETH,
  // will set this field to `undefined`:
  networkLocation: JsonObject | void
}

export type EdgeTokenMap = {
  // Each currency plugin decides how to generate this ID,
  // such as by using the contract address:
  [tokenId: string]: EdgeToken
}

/**
 * Available tokens stored in the `EdgeCurrencyInfo`,
 * or parsed out of URI's.
 */
export type EdgeMetaToken = {
  currencyCode: string,
  currencyName: string,
  contractAddress?: string,

  denominations: EdgeDenomination[],
  symbolImage?: string
}

/**
 * Tokens passed to `addCustomToken`.
 */
export type EdgeTokenInfo = {
  currencyCode: string,
  currencyName: string,
  contractAddress: string,

  multiplier: string
}

// currency info -------------------------------------------------------

type EdgeObjectTemplate = Array<
  | {
      type: 'nativeAmount',
      key: string,
      displayName: string,
      displayMultiplier: string
    }
  | {
      type: 'number',
      key: string,
      displayName: string
    }
  | {
      type: 'string',
      key: string,
      displayName: string
    }
>

export type EdgeCurrencyInfo = {
  // Basic currency information:
  +pluginId: string,
  displayName: string,
  walletType: string,

  // Native token information:
  currencyCode: string,
  denominations: EdgeDenomination[],

  // Chain information:
  canAdjustFees?: boolean, // Defaults to true
  canImportKeys?: boolean, // Defaults to false
  customFeeTemplate?: EdgeObjectTemplate, // Indicates custom fee support
  customTokenTemplate?: EdgeObjectTemplate, // Indicates custom token support
  requiredConfirmations?: number,
  memoMaxLength?: number, // Max number of text characters, if supported
  memoMaxValue?: string, // Max numerical value, if supported
  memoType?: 'text' | 'number' | 'other', // undefined means no memo support

  // Configuration options:
  defaultSettings: JsonObject,
  metaTokens: EdgeMetaToken[],

  // Explorers:
  addressExplorer: string,
  blockExplorer?: string,
  transactionExplorer: string,
  xpubExplorer?: string,

  // Images:
  symbolImage?: string,
  symbolImageDarkMono?: string
}

// spending ------------------------------------------------------------

export type EdgeMetadata = {
  bizId?: number,
  category?: string,
  exchangeAmount?: { [fiatCurrencyCode: string]: number },
  name?: string,
  notes?: string,

  // Deprecated. Use exchangeAmount instead:
  amountFiat?: number
}

export type EdgeNetworkFee = {
  +currencyCode: string,
  +nativeAmount: string
}

export type EdgeTxSwap = {
  orderId?: string,
  orderUri?: string,
  isEstimate: boolean,

  // The EdgeSwapInfo from the swap plugin:
  plugin: {
    pluginId: string,
    displayName: string,
    supportEmail?: string
  },

  // Address information:
  payoutAddress: string,
  payoutCurrencyCode: string,
  payoutNativeAmount: string,
  payoutWalletId: string,
  refundAddress?: string
}

export type EdgeTransaction = {
  // Amounts:
  currencyCode: string,
  nativeAmount: string,

  // Fees:
  networkFee: string,
  parentNetworkFee?: string,

  // Confirmation status:
  blockHeight: number,
  date: number,

  // Transaction info:
  txid: string,
  signedTx: string,
  ourReceiveAddresses: string[],

  // Spend-specific metadata:
  deviceDescription?: string,
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom',
  requestedCustomFee?: JsonObject,
  feeRateUsed?: JsonObject,
  spendTargets?: Array<{
    +currencyCode: string,
    +memo: string | void,
    +nativeAmount: string,
    +publicAddress: string,

    // Deprecated:
    uniqueIdentifier: string | void // Use memo instead.
  }>,
  swapData?: EdgeTxSwap,
  txSecret?: string, // Monero decryption key

  // Core:
  metadata?: EdgeMetadata,
  wallet?: EdgeCurrencyWallet, // eslint-disable-line no-use-before-define
  otherParams?: JsonObject
}

export type EdgeSpendTarget = {
  memo?: string,
  nativeAmount?: string,
  otherParams?: JsonObject,
  publicAddress?: string,

  // Deprecated:
  uniqueIdentifier?: string // Use memo instead.
}

export type EdgePaymentProtocolInfo = {
  domain: string,
  memo: string,
  merchant: string,
  nativeAmount: string,
  spendTargets: EdgeSpendTarget[]
}

export type EdgeSpendInfo = {
  // Basic information:
  currencyCode?: string,
  privateKeys?: string[],
  spendTargets: EdgeSpendTarget[],

  // Options:
  noUnconfirmed?: boolean,
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom',
  customNetworkFee?: JsonObject, // Some kind of currency-specific JSON
  rbfTxid?: string,

  // Core:
  metadata?: EdgeMetadata,
  swapData?: EdgeTxSwap,
  otherParams?: JsonObject
}

// query data ----------------------------------------------------------

export type EdgeDataDump = {
  walletId: string,
  walletType: string,
  data: {
    [dataCache: string]: JsonObject
  }
}

export type EdgeFreshAddress = {
  publicAddress: string,
  segwitAddress?: string,
  legacyAddress?: string
}

/**
 * Balances, unlock dates, and other information about staked funds.
 *
 * The currency engine is responsible for keeping this up to date.
 * For instance, if the user submits a transaction to unlock funds,
 * the engine should update this data once it detects that transaction,
 * and then again once the funds actually unlock some time later.
 *
 * As with wallet balances, this data may not be reliable until the
 * `syncRatio` hits 1.
 */
export type EdgeStakingStatus = {
  // Funds can be in various stages of being locked or unlocked,
  // so each row can describe a single batch of locked coins.
  // Adding together the rows in this array should give the
  // total amount of locked-up funds in the wallet:
  stakedAmounts: Array<{
    nativeAmount: string,

    // Maybe these funds are not the chain's parent currency:
    // tokenId?: string,

    // Maybe these funds are being unlocked?
    unlockDate?: Date,

    // Feel free to add other weird coin states here.
    // We can standardize them later if they are common:
    otherParams?: JsonObject
  }>
}

export type EdgeTxidMap = { [txid: string]: number }

// URI -----------------------------------------------------------------

export type WalletConnect = {
  uri: string,
  topic: string,
  version?: string,
  bridge?: string,
  key?: string
}

export type EdgeParsedUri = {
  bitIDCallbackUri?: string,
  bitIDDomain?: string,
  bitidKycProvider?: string, // Experimental
  bitidKycRequest?: string, // Experimental
  bitidPaymentAddress?: string, // Experimental
  bitIDURI?: string,
  currencyCode?: string,
  legacyAddress?: string,
  metadata?: EdgeMetadata,
  nativeAmount?: string,
  paymentProtocolUrl?: string,
  privateKeys?: string[],
  publicAddress?: string,
  returnUri?: string,
  segwitAddress?: string,
  token?: EdgeMetaToken,
  uniqueIdentifier?: string, // Ripple payment id
  walletConnect?: WalletConnect
}

export type EdgeEncodeUri = {
  publicAddress: string,
  nativeAmount?: string,
  label?: string,
  message?: string,
  currencyCode?: string
}

// options -------------------------------------------------------------

export type EdgeCurrencyCodeOptions = {
  currencyCode?: string
}

export type EdgeGetTransactionsOptions = {
  currencyCode?: string,
  startIndex?: number,
  startEntries?: number,
  startDate?: Date,
  endDate?: Date,
  searchString?: string,
  returnIndex?: number,
  returnEntries?: number,
  denomination?: string
}

// engine --------------------------------------------------------------

export type EdgeCurrencyEngineCallbacks = {
  +onAddressChanged: () => void,
  +onAddressesChecked: (progressRatio: number) => void,
  +onBalanceChanged: (currencyCode: string, nativeBalance: string) => void,
  +onBlockHeightChanged: (blockHeight: number) => void,
  +onStakingStatusChanged: (status: EdgeStakingStatus) => void,
  +onTransactionsChanged: (transactions: EdgeTransaction[]) => void,
  +onTxidsChanged: (txids: EdgeTxidMap) => void,
  +onWcNewContractCall: (payload: JsonObject) => void
}

export type EdgeCurrencyEngineOptions = {
  callbacks: EdgeCurrencyEngineCallbacks,
  log: EdgeLog, // Wallet-scoped logging
  walletLocalDisklet: Disklet,
  walletLocalEncryptedDisklet: Disklet,
  userSettings: JsonObject | void
}

export type EdgeCurrencyEngine = {
  +changeUserSettings: (settings: JsonObject) => Promise<void>,

  // Keys:
  +getDisplayPrivateSeed: () => string | null,
  +getDisplayPublicSeed: () => string | null,

  // Engine status:
  +startEngine: () => Promise<void>,
  +killEngine: () => Promise<void>,
  +resyncBlockchain: () => Promise<void>,
  +dumpData: () => Promise<EdgeDataDump>,

  // Chain state:
  +getBlockHeight: () => number,
  +getBalance: (opts: EdgeCurrencyCodeOptions) => string,
  +getNumTransactions: (opts: EdgeCurrencyCodeOptions) => number,
  +getTransactions: (
    opts: EdgeGetTransactionsOptions
  ) => Promise<EdgeTransaction[]>,
  +getTxids?: () => EdgeTxidMap,

  // Tokens:
  +enableTokens: (tokens: string[]) => Promise<void>,
  +disableTokens: (tokens: string[]) => Promise<void>,
  +getEnabledTokens: () => Promise<string[]>,
  +addCustomToken: (token: EdgeTokenInfo) => Promise<void>,
  +getTokenStatus: (token: string) => boolean,

  // Addresses:
  +getFreshAddress: (
    opts: EdgeCurrencyCodeOptions
  ) => Promise<EdgeFreshAddress>,
  +addGapLimitAddresses: (addresses: string[]) => Promise<void>,
  +isAddressUsed: (address: string) => Promise<boolean>,

  // Spending:
  +getMaxSpendable?: (spendInfo: EdgeSpendInfo) => Promise<string>,
  +makeSpend: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  +signTx: (transaction: EdgeTransaction) => Promise<EdgeTransaction>,
  +broadcastTx: (transaction: EdgeTransaction) => Promise<EdgeTransaction>,
  +saveTx: (transaction: EdgeTransaction) => Promise<void>,
  +sweepPrivateKeys?: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  +getPaymentProtocolInfo?: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>,

  // Staking:
  +getStakingStatus?: () => Promise<EdgeStakingStatus>,

  // Escape hatch:
  +otherMethods?: EdgeOtherMethods
}

// currency plugin -----------------------------------------------------

export type EdgeMemoRules = {
  passed: boolean,
  tooLarge?: boolean, // Too large numerically
  tooLong?: boolean, // Too many characters
  invalidCharacters?: boolean // Wrong character types
}

export type EdgeCurrencyTools = {
  // Keys:
  +importPrivateKey?: (key: string, opts?: JsonObject) => Promise<JsonObject>,
  +createPrivateKey: (
    walletType: string,
    opts?: JsonObject
  ) => Promise<JsonObject>,
  +derivePublicKey: (walletInfo: EdgeWalletInfo) => Promise<JsonObject>,
  +getSplittableTypes?: (walletInfo: EdgeWalletInfo) => string[],

  // URIs:
  +parseUri: (
    uri: string,
    currencyCode?: string,
    customTokens?: EdgeMetaToken[]
  ) => Promise<EdgeParsedUri>,
  +encodeUri: (
    obj: EdgeEncodeUri,
    customTokens?: EdgeMetaToken[]
  ) => Promise<string>,

  // Transaction memos:
  +validateMemo?: (memo: string) => Promise<EdgeMemoRules>
}

export type EdgeCurrencyPlugin = {
  +currencyInfo: EdgeCurrencyInfo,

  +makeCurrencyTools: () => Promise<EdgeCurrencyTools>,
  +makeCurrencyEngine: (
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ) => Promise<EdgeCurrencyEngine>,

  // Escape hatch:
  +otherMethods?: EdgeOtherMethods
}

// wallet --------------------------------------------------------------

export type EdgeBalances = { [currencyCode: string]: string }

export type EdgeReceiveAddress = EdgeFreshAddress & {
  metadata: EdgeMetadata,
  nativeAmount: string
}

export type EdgeCurrencyWalletEvents = {
  close: void,
  newTransactions: EdgeTransaction[],
  addressChanged: void,
  transactionsChanged: EdgeTransaction[],
  wcNewContractCall: JsonObject
}

export type EdgeCurrencyWallet = {
  +on: Subscriber<EdgeCurrencyWalletEvents>,
  +watch: Subscriber<EdgeCurrencyWallet>,

  // Data store:
  +id: string,
  +keys: JsonObject,
  +type: string,
  +publicWalletInfo: EdgeWalletInfo,
  +disklet: Disklet,
  +localDisklet: Disklet,
  +sync: () => Promise<void>,

  // Wallet keys:
  +displayPrivateSeed: string | null,
  +displayPublicSeed: string | null,

  // Wallet name:
  +name: string | null,
  +renameWallet: (name: string) => Promise<void>,

  // Fiat currency option:
  +fiatCurrencyCode: string,
  +setFiatCurrencyCode: (fiatCurrencyCode: string) => Promise<void>,

  // Currency info:
  +currencyInfo: EdgeCurrencyInfo,
  +validateMemo: (memo: string) => Promise<EdgeMemoRules>,
  +nativeToDenomination: (
    nativeAmount: string,
    currencyCode: string
  ) => Promise<string>,
  +denominationToNative: (
    denominatedAmount: string,
    currencyCode: string
  ) => Promise<string>,

  // Chain state:
  +balances: EdgeBalances,
  +blockHeight: number,
  +syncRatio: number,

  // Running state:
  +paused: boolean,
  +changePaused: (paused: boolean) => Promise<void>,

  // Token management:
  +changeEnabledTokens: (currencyCodes: string[]) => Promise<void>,
  +enableTokens: (tokens: string[]) => Promise<void>,
  +disableTokens: (tokens: string[]) => Promise<void>,
  +getEnabledTokens: () => Promise<string[]>,
  +addCustomToken: (token: EdgeTokenInfo) => Promise<void>,

  // Transaction history:
  +getNumTransactions: (opts?: EdgeCurrencyCodeOptions) => Promise<number>,
  +getTransactions: (
    opts?: EdgeGetTransactionsOptions
  ) => Promise<EdgeTransaction[]>,

  // Addresses:
  +getReceiveAddress: (
    opts?: EdgeCurrencyCodeOptions
  ) => Promise<EdgeReceiveAddress>,
  +saveReceiveAddress: (receiveAddress: EdgeReceiveAddress) => Promise<void>,
  +lockReceiveAddress: (receiveAddress: EdgeReceiveAddress) => Promise<void>,

  // Sending:
  +makeSpend: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  +signTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>,
  +broadcastTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>,
  +saveTx: (tx: EdgeTransaction) => Promise<void>,
  +sweepPrivateKeys: (edgeSpendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  +saveTxMetadata: (
    txid: string,
    currencyCode: string,
    metadata: EdgeMetadata
  ) => Promise<void>,
  +getMaxSpendable: (spendInfo: EdgeSpendInfo) => Promise<string>,
  +getPaymentProtocolInfo: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>,

  // Staking:
  +stakingStatus: EdgeStakingStatus,

  // Wallet management:
  +resyncBlockchain: () => Promise<void>,
  +dumpData: () => Promise<EdgeDataDump>,

  // URI handling:
  +parseUri: (uri: string, currencyCode?: string) => Promise<EdgeParsedUri>,
  +encodeUri: (obj: EdgeEncodeUri) => Promise<string>,

  +otherMethods: EdgeOtherMethods
}

// ---------------------------------------------------------------------
// swap plugin
// ---------------------------------------------------------------------

/**
 * Static data about a swap plugin.
 */
export type EdgeSwapInfo = {
  +pluginId: string,
  +displayName: string,

  +orderUri?: string, // The orderId would be appended to this
  +supportEmail: string
}

export type EdgeSwapRequest = {
  // Where?
  fromWallet: EdgeCurrencyWallet,
  toWallet: EdgeCurrencyWallet,

  // What?
  fromCurrencyCode: string,
  toCurrencyCode: string,

  // How much?
  nativeAmount: string,
  quoteFor: 'from' | 'max' | 'to'
}

/**
 * If the user approves a quote, the plugin performs the transaction
 * and returns this as the result.
 */
export type EdgeSwapResult = {
  +orderId?: string,
  +destinationAddress?: string,
  +transaction: EdgeTransaction
}

/**
 * If a provider can satisfy a request, what is their price?
 */
export type EdgeSwapQuote = {
  +isEstimate: boolean,
  +fromNativeAmount: string,
  +toNativeAmount: string,
  +networkFee: EdgeNetworkFee,

  +pluginId: string,
  +expirationDate?: Date,

  +approve: () => Promise<EdgeSwapResult>,
  +close: () => Promise<void>
}

export type EdgeSwapPluginStatus = {
  needsActivation?: boolean
}

export type EdgeSwapPlugin = {
  +swapInfo: EdgeSwapInfo,

  +checkSettings?: (userSettings: JsonObject) => EdgeSwapPluginStatus,
  +fetchSwapQuote: (
    request: EdgeSwapRequest,
    userSettings: JsonObject | void,
    opts: { promoCode?: string }
  ) => Promise<EdgeSwapQuote>
}

// ---------------------------------------------------------------------
// rate plugin
// ---------------------------------------------------------------------

export type EdgeRateHint = {
  fromCurrency: string,
  toCurrency: string
}

export type EdgeRateInfo = {
  +pluginId: string,
  +displayName: string
}

export type EdgeRatePair = {
  fromCurrency: string,
  toCurrency: string,
  rate: number
}

export type EdgeRatePlugin = {
  +rateInfo: EdgeRateInfo,

  +fetchRates: (hints: EdgeRateHint[]) => Promise<EdgeRatePair[]>
}

// ---------------------------------------------------------------------
// account
// ---------------------------------------------------------------------

export type EdgeAccountOptions = {
  now?: Date, // The current time, if different from `new Date()`
  otpKey?: string, // The OTP secret
  otp?: string, // The 6-digit OTP, or (deprecated) the OTP secret
  pauseWallets?: boolean // True to start wallets in the paused state
}

/**
 * A pending request to log in from a new device.
 */
export type EdgePendingVoucher = {
  voucherId: string,
  activates: Date,
  created: Date,
  deviceDescription?: string,
  ip: string,
  ipDescription: string
}

// currencies ----------------------------------------------------------

export type EdgeCreateCurrencyWalletOptions = {
  fiatCurrencyCode?: string,
  name?: string,

  // Create a private key from some text:
  importText?: string,

  // Used to tell the currency plugin what keys to create:
  keyOptions?: JsonObject,

  // Used to copy wallet keys between accounts:
  keys?: JsonObject
}

export type EdgeCurrencyConfig = {
  +watch: Subscriber<EdgeCurrencyConfig>,

  +currencyInfo: EdgeCurrencyInfo,

  // User settings for this plugin:
  +userSettings: JsonObject | void,
  +changeUserSettings: (settings: JsonObject) => Promise<void>,

  // Utility methods:
  +importKey: (
    userInput: string,
    opts?: { keyOptions?: JsonObject }
  ) => Promise<JsonObject>,
  +otherMethods: EdgeOtherMethods
}

export type EthereumTransaction = {
  chainId: number, // Not part of raw data, but needed for signing
  nonce: string,
  gasPrice: string,
  gasLimit: string,
  to: string,
  value: string,
  data: string,
  // The transaction is unsigned, so these are not present:
  v?: string,
  r?: string,
  s?: string
}

// rates ---------------------------------------------------------------

export type EdgeRateCacheEvents = {
  close: void,
  update: mixed
}

export type EdgeConvertCurrencyOpts = {
  biases?: { [name: string]: number }
}

export type EdgeRateCache = {
  +on: Subscriber<EdgeRateCacheEvents>,

  +convertCurrency: (
    fromCurrency: string,
    toCurrency: string,
    amount?: number,
    opts?: EdgeConvertCurrencyOpts
  ) => Promise<number>
}

// swap ----------------------------------------------------------------

/**
 * Information and settings for a currency swap plugin.
 */
export type EdgeSwapConfig = {
  +watch: Subscriber<EdgeSwapConfig>,

  +enabled: boolean,
  +needsActivation: boolean,
  +swapInfo: EdgeSwapInfo,
  +userSettings: JsonObject | void,

  +changeEnabled: (enabled: boolean) => Promise<void>,
  +changeUserSettings: (settings: JsonObject) => Promise<void>
}

export type EdgeSwapRequestOptions = {
  preferPluginId?: string,
  disabled?: EdgePluginMap<true>,
  promoCodes?: EdgePluginMap<string>
}

// edge login ----------------------------------------------------------

export type EdgeLoginRequest = {
  +appId: string,
  +approve: () => Promise<void>,

  +displayName: string,
  +displayImageUrl: string | void
}

export type EdgeLobby = {
  +loginRequest: EdgeLoginRequest | void
  // walletRequest: EdgeWalletRequest | void
}

// storage -------------------------------------------------------------

export type EdgeDataStore = {
  +deleteItem: (storeId: string, itemId: string) => Promise<void>,
  +deleteStore: (storeId: string) => Promise<void>,

  +listItemIds: (storeId: string) => Promise<string[]>,
  +listStoreIds: () => Promise<string[]>,

  +getItem: (storeId: string, itemId: string) => Promise<string>,
  +setItem: (storeId: string, itemId: string, value: string) => Promise<void>
}

// account -------------------------------------------------------------

export type EdgeAccountEvents = {
  close: void
}

export type EdgeAccount = {
  +on: Subscriber<EdgeAccountEvents>,
  +watch: Subscriber<EdgeAccount>,

  // Data store:
  +id: string,
  +keys: JsonObject,
  +type: string,
  +disklet: Disklet,
  +localDisklet: Disklet,
  +sync: () => Promise<void>,

  // Basic login information:
  +appId: string,
  +created: Date | void, // Not always known
  +lastLogin: Date,
  +loggedIn: boolean,
  +loginKey: string, // base58
  +recoveryKey: string | void, // base58, for email backup
  +rootLoginId: string, // base58
  +username: string,

  // Special-purpose API's:
  +currencyConfig: EdgePluginMap<EdgeCurrencyConfig>,
  +rateCache: EdgeRateCache,
  +swapConfig: EdgePluginMap<EdgeSwapConfig>,
  +dataStore: EdgeDataStore,

  // What login method was used?
  +edgeLogin: boolean,
  +keyLogin: boolean,
  +newAccount: boolean,
  +passwordLogin: boolean,
  +pinLogin: boolean,
  +recoveryLogin: boolean,

  // Change or create credentials:
  +changePassword: (password: string) => Promise<void>,
  +changePin: (opts: {
    pin?: string, // We keep the existing PIN if unspecified
    enableLogin?: boolean // We default to true if unspecified
  }) => Promise<string>,
  +changeRecovery: (questions: string[], answers: string[]) => Promise<string>,

  // Verify existing credentials:
  +checkPassword: (password: string) => Promise<boolean>,
  +checkPin: (pin: string) => Promise<boolean>,

  // Remove credentials:
  +deletePassword: () => Promise<void>,
  +deletePin: () => Promise<void>,
  +deleteRecovery: () => Promise<void>,

  // OTP:
  +otpKey: string | void, // OTP is enabled if this exists
  +otpResetDate: Date | void, // A reset is requested if this exists
  +cancelOtpReset: () => Promise<void>,
  +disableOtp: () => Promise<void>,
  +enableOtp: (timeout?: number) => Promise<void>,
  +repairOtp: (otpKey: string) => Promise<void>,

  // 2fa bypass voucher approval / rejection:
  +pendingVouchers: EdgePendingVoucher[],
  +approveVoucher: (voucherId: string) => Promise<void>,
  +rejectVoucher: (voucherId: string) => Promise<void>,

  // Edge login approval:
  +fetchLobby: (lobbyId: string) => Promise<EdgeLobby>,

  // Login management:
  +logout: () => Promise<void>,

  // Master wallet list:
  +allKeys: EdgeWalletInfoFull[],
  +changeWalletStates: (walletStates: EdgeWalletStates) => Promise<void>,
  +createWallet: (type: string, keys?: JsonObject) => Promise<string>,
  +getFirstWalletInfo: (type: string) => EdgeWalletInfo | void,
  +getWalletInfo: (id: string) => EdgeWalletInfo | void,
  +listWalletIds: () => string[],
  +listSplittableWalletTypes: (walletId: string) => Promise<string[]>,
  +splitWalletInfo: (
    walletId: string,
    newWalletType: string
  ) => Promise<string>,

  // Currency wallets:
  +activeWalletIds: string[],
  +archivedWalletIds: string[],
  +hiddenWalletIds: string[],
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet },
  +createCurrencyWallet: (
    type: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ) => Promise<EdgeCurrencyWallet>,
  +waitForCurrencyWallet: (walletId: string) => Promise<EdgeCurrencyWallet>,

  // Web compatibility:
  +signEthereumTransaction: (
    walletId: string,
    transaction: EthereumTransaction
  ) => Promise<string>,

  // Swapping:
  +fetchSwapQuote: (
    request: EdgeSwapRequest,
    opts?: EdgeSwapRequestOptions
  ) => Promise<EdgeSwapQuote>
}

// ---------------------------------------------------------------------
// context types
// ---------------------------------------------------------------------

export type EdgeCorePlugin =
  | EdgeCurrencyPlugin
  | EdgeRatePlugin
  | EdgeSwapPlugin

type EdgeCorePluginFactory = (env: EdgeCorePluginOptions) => EdgeCorePlugin

export type EdgeCorePlugins = EdgePluginMap<
  EdgeCorePlugin | EdgeCorePluginFactory
>

export type EdgeCorePluginsInit = EdgePluginMap<boolean | JsonObject>

export type EdgeContextOptions = {
  apiKey: string,
  appId: string,
  authServer?: string,
  hideKeys?: boolean,

  // Intercepts crash reports:
  crashReporter?: EdgeCrashReporter,

  // A string to describe this phone or app:
  deviceDescription?: string,

  // Intercepts all console logging:
  onLog?: EdgeOnLog,
  logSettings?: Partial<EdgeLogSettings>,

  path?: string, // Only used on node.js
  plugins?: EdgeCorePluginsInit
}

export type EdgeRecoveryQuestionChoice = {
  category: 'address' | 'must' | 'numeric' | 'recovery2' | 'string',
  min_length: number,
  question: string
}

// parameters ----------------------------------------------------------

export type EdgeLoginMessage = {
  loginId: string, // base64
  otpResetPending: boolean,
  pendingVouchers: EdgePendingVoucher[],
  recovery2Corrupt: boolean
}

export type EdgeLoginMessages = {
  [username: string]: EdgeLoginMessage
}

export type EdgePasswordRules = {
  secondsToCrack: number,
  tooShort: boolean,
  noNumber: boolean,
  noLowerCase: boolean,
  noUpperCase: boolean,
  passed: boolean
}

/**
 * A barcode login request.
 *
 * The process begins by showing the user a QR code with the request id,
 * in the format `edge://edge/${id}`.
 *
 * Once the user sends their response, the state will move from "pending"
 * to "started" and the "username" property will hold the received username.
 *
 * Once the login finishes, the state will move from "started" to "done",
 * and the "account" property will hold the new account object.
 *
 * Otherwise, if something goes wrong, the state will move from "started"
 * to "error", and the "error" property will hold the error.
 *
 * Calling "cancelRequest" stops the process and sets the state to "closed".
 * This method is only callable in the "pending" and "started" states.
 *
 * Use the `watch('state', callback)` method to subscribe to state changes.
 */
export type EdgePendingEdgeLogin = {
  +watch: Subscriber<EdgePendingEdgeLogin>,
  +id: string,

  +state: 'pending' | 'started' | 'done' | 'error' | 'closed',
  +username?: string, // Set in the "started" state
  +account?: EdgeAccount, // Set in the "done" state
  +error?: mixed, // Set in the "error" state

  +cancelRequest: () => Promise<void>
}

export type EdgeUserInfo = {
  keyLoginEnabled: boolean,
  lastLogin?: Date,
  pinLoginEnabled: boolean,
  recovery2Key?: string, // base58
  username: string,
  voucherId?: string
}

// context -------------------------------------------------------------

export type EdgeContextEvents = {
  close: void,
  error: Error
}

export type EdgeContext = {
  +on: Subscriber<EdgeContextEvents>,
  +watch: Subscriber<EdgeContext>,
  +close: () => Promise<void>,

  +appId: string,

  // Local user management:
  localUsers: EdgeUserInfo[],
  +fixUsername: (username: string) => string,
  +listUsernames: () => Promise<string[]>,
  +deleteLocalAccount: (username: string) => Promise<void>,

  // Account creation:
  +usernameAvailable: (username: string) => Promise<boolean>,
  +createAccount: (
    username: string,
    password?: string,
    pin?: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>,

  // Edge login:
  +requestEdgeLogin: (
    opts?: EdgeAccountOptions
  ) => Promise<EdgePendingEdgeLogin>,

  // Fingerprint login:
  +loginWithKey: (
    username: string,
    loginKey: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>,

  // Password login:
  +checkPasswordRules: (password: string) => EdgePasswordRules,
  +loginWithPassword: (
    username: string,
    password: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>,

  // PIN login:
  +pinLoginEnabled: (username: string) => Promise<boolean>,
  +loginWithPIN: (
    username: string,
    pin: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>,

  // Recovery2 login:
  +loginWithRecovery2: (
    recovery2Key: string,
    username: string,
    answers: string[],
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>,
  +fetchRecovery2Questions: (
    recovery2Key: string,
    username: string
  ) => Promise<string[]>,
  // Really returns EdgeRecoveryQuestionChoice[]:
  +listRecoveryQuestionChoices: () => Promise<any>,

  // OTP stuff:
  +requestOtpReset: (username: string, otpResetToken: string) => Promise<Date>,
  +fetchLoginMessages: () => Promise<EdgeLoginMessages>,

  // Background mode:
  +paused: boolean,
  +changePaused: (
    paused: boolean,
    opts?: { secondsDelay?: number }
  ) => Promise<void>,

  // Logging options:
  +logSettings: EdgeLogSettings,
  +changeLogSettings: (settings: Partial<EdgeLogSettings>) => Promise<void>
}

// ---------------------------------------------------------------------
// fake mode
// ---------------------------------------------------------------------

export type EdgeFakeWorldOptions = {
  crashReporter?: EdgeCrashReporter,
  onLog?: EdgeOnLog
}

export type EdgeFakeContextOptions = {
  // EdgeContextOptions:
  apiKey: string,
  appId: string,
  deviceDescription?: string,
  hideKeys?: boolean,
  logSettings?: Partial<EdgeLogSettings>,
  plugins?: EdgeCorePluginsInit,

  // Fake device options:
  cleanDevice?: boolean
}

/**
 * A block of JSON data that can be used to save & restore a user
 * on the fake unit-testing server.
 */
export type EdgeFakeUser = {
  username: string,
  lastLogin?: Date,
  loginId: string, // base64
  loginKey: string, // base64
  repos: { [repo: string]: { [path: string]: any /* asEdgeBox */ } },
  server: any // asLoginDump
}

export type EdgeFakeWorld = {
  +close: () => Promise<void>,

  +makeEdgeContext: (opts: EdgeFakeContextOptions) => Promise<EdgeContext>,

  +goOffline: (offline?: boolean) => Promise<void>,
  +dumpFakeUser: (account: EdgeAccount) => Promise<EdgeFakeUser>
}

// ---------------------------------------------------------------------
// deprecated types
// ---------------------------------------------------------------------

export type EdgeBitcoinPrivateKeyOptions = {
  format?: string,
  coinType?: number,
  account?: number
}

export type EdgeCreatePrivateKeyOptions =
  | EdgeBitcoinPrivateKeyOptions
  | JsonObject

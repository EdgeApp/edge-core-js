import type { Disklet } from 'disklet'
import type {
  FetchFunction,
  FetchHeaders,
  FetchOptions,
  FetchResponse
} from 'serverlet'
import type { Subscriber } from 'yaob'

export * from './error'

// ---------------------------------------------------------------------
// helper types
// ---------------------------------------------------------------------

/** A JSON object (as opposed to an array or primitive). */
export interface JsonObject {
  [name: string]: any // TODO: this needs to become `unknown`
}

/** A collection of unknown extra methods exposed by a plugin. */
export interface EdgeOtherMethods {
  readonly [name: string]: any
}

/** We frequently index things by pluginId, so provide a helper. */
export interface EdgePluginMap<Value> {
  [pluginId: string]: Value
}

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
export interface EdgeIo {
  // Crypto:
  readonly random: EdgeRandomFunction
  readonly scrypt: EdgeScryptFunction

  // Local io:
  readonly disklet: Disklet
  readonly fetch: EdgeFetchFunction

  // This is only present if the platform has some way to avoid CORS:
  readonly fetchCors?: EdgeFetchFunction
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
  readonly breadcrumb: (message: string, metadata: JsonObject) => void
  readonly crash: (error: unknown, metadata: JsonObject) => void

  // Message logging:
  readonly warn: EdgeLogMethod
  readonly error: EdgeLogMethod
}

export type EdgeLogType = 'info' | 'warn' | 'error'

export interface EdgeLogSettings {
  sources: { [pluginId: string]: EdgeLogType | 'silent' }
  defaultLogLevel: EdgeLogType | 'silent'
}

/**
 * The EdgeLog function stringifies its arguments and adds
 * some extra information to form this event type.
 */
export interface EdgeLogEvent {
  message: string
  source: string
  time: Date
  type: EdgeLogType
}

export interface EdgeBreadcrumbEvent {
  message: string
  metadata: JsonObject
  source: string
  time: Date
}

export interface EdgeCrashEvent {
  error: unknown
  metadata: JsonObject
  source: string
  time: Date
}

/**
 * Receives crash reports.
 * The app should implement this interface and pass it to the context.
 */
export interface EdgeCrashReporter {
  readonly logBreadcrumb: (breadcrumb: EdgeBreadcrumbEvent) => void
  readonly logCrash: (crash: EdgeCrashEvent) => void
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
export interface EdgeNativeIo {
  [packageName: string]: EdgeOtherMethods
}

/**
 * All core plugins receive these options at creation time.
 */
export interface EdgeCorePluginOptions {
  // Load-time options (like API keys) passed into the context:
  initOptions: JsonObject

  // Access to the world outside the plugin:
  io: EdgeIo
  log: EdgeLog // Plugin-scoped logging
  nativeIo: EdgeNativeIo // Only filled in on React Native
  pluginDisklet: Disklet // Plugin-scoped local storage
}

// ---------------------------------------------------------------------
// key types
// ---------------------------------------------------------------------

export interface EdgeWalletInfo {
  id: string
  type: string
  keys: JsonObject
}

export type EdgeWalletInfoFull = EdgeWalletInfo & {
  appIds: string[]
  archived: boolean
  deleted: boolean
  hidden: boolean
  migratedFromWalletId?: string
  sortIndex: number
}

export interface EdgeWalletState {
  archived?: boolean
  deleted?: boolean
  hidden?: boolean
  migratedFromWalletId?: string
  sortIndex?: number
}

export interface EdgeWalletStates {
  [walletId: string]: EdgeWalletState
}

// ---------------------------------------------------------------------
// currency types
// ---------------------------------------------------------------------

// token info ----------------------------------------------------------

export interface EdgeDenomination {
  // Multiply a display amount by this number to get the native amount.
  // BTC would use "100000000", for instance:
  multiplier: string

  // A display name for this denomination, like "BTC", "bits", or "sats":
  name: string

  // A prefix to add to the formatted number, like "₿", "ƀ", or "s":
  symbol?: string
}

/**
 * Information used to display a token or currency to the user.
 */
export interface EdgeToken {
  // The short code used on exchanges, such as "BTC":
  currencyCode: string

  // How many decimal places to shift the native amount.
  // The first item in this array is always the default for exchanges:
  denominations: EdgeDenomination[]

  // The full marketing name, such as "Bitcoin":
  displayName: string

  // Each currency plugin decides what this contains,
  // such as a contract address.
  // This may be `undefined` for special built-in tokens
  // such as staking balances.
  networkLocation: JsonObject | undefined
}

export interface EdgeTokenMap {
  // Each currency plugin decides how to generate this ID,
  // such as by using the contract address:
  [tokenId: string]: EdgeToken
}

/**
 * Available tokens stored in the `EdgeCurrencyInfo`,
 * or parsed out of URI's.
 */
export interface EdgeMetaToken {
  currencyCode: string
  currencyName: string
  contractAddress?: string

  denominations: EdgeDenomination[]
  symbolImage?: string
}

/**
 * Tokens passed to `addCustomToken`.
 */
export interface EdgeTokenInfo {
  currencyCode: string
  currencyName: string
  contractAddress: string

  multiplier: string
}

// currency info -------------------------------------------------------

type EdgeObjectTemplate = Array<
  | {
      type: 'nativeAmount'
      key: string
      displayName: string
      displayMultiplier: string
    }
  | {
      type: 'number'
      key: string
      displayName: string
    }
  | {
      type: 'string'
      key: string
      displayName: string
    }
>

export interface EdgeCurrencyInfo {
  // Basic currency information:
  readonly pluginId: string
  displayName: string
  walletType: string

  // Native token information:
  currencyCode: string
  denominations: EdgeDenomination[]

  // Chain information:
  canAdjustFees?: boolean // Defaults to true
  canImportKeys?: boolean // Defaults to false
  canReplaceByFee?: boolean // Defaults to false
  customFeeTemplate?: EdgeObjectTemplate // Indicates custom fee support
  customTokenTemplate?: EdgeObjectTemplate // Indicates custom token support
  requiredConfirmations?: number // Block confirmations required for a tx
  memoMaxLength?: number // Max number of text characters, if supported
  memoMaxValue?: string // Max numerical value, if supported
  memoType?: 'text' | 'number' | 'hex' | 'other' // undefined means no memo support

  // Explorers:
  addressExplorer: string
  blockExplorer?: string
  transactionExplorer: string
  xpubExplorer?: string

  // Flags:
  unsafeBroadcastTx?: boolean
  unsafeMakeSpend?: boolean
  unsafeSyncNetwork?: boolean

  /** @deprecated The default user settings are always `{}` */
  defaultSettings: JsonObject

  /** @deprecated Use EdgeCurrencyPlugin.getBuiltinTokens instead */
  metaTokens: EdgeMetaToken[]

  /** @deprecated Unused. The GUI handles this now */
  symbolImage?: string

  /** @deprecated Unused. The GUI handles this now */
  symbolImageDarkMono?: string
}

// spending ------------------------------------------------------------

export interface EdgeMetadata {
  bizId?: number
  category?: string
  exchangeAmount?: { [fiatCurrencyCode: string]: number }
  name?: string
  notes?: string

  /** @deprecated Use exchangeAmount instead */
  amountFiat?: number
}

// Would prefer a better name than EdgeNetworkFee2 but can't think of one
export interface EdgeNetworkFee2 {
  readonly nativeAmount: string
  readonly currencyPluginId: string
  readonly tokenId?: string
}

export interface EdgeTxSwap {
  orderId?: string
  orderUri?: string
  isEstimate: boolean

  // The EdgeSwapInfo from the swap plugin:
  plugin: {
    pluginId: string
    displayName: string
    supportEmail?: string
  }

  // Address information:
  payoutAddress: string
  payoutCurrencyCode: string
  payoutNativeAmount: string
  payoutWalletId: string
  refundAddress?: string
}

export interface EdgeTransaction {
  // Amounts:
  currencyCode: string
  nativeAmount: string

  // Fees:
  networkFee: string
  parentNetworkFee?: string

  // Confirmation status:
  confirmations?: 'confirmed' | 'unconfirmed' | 'syncing' | 'dropped' | number
  blockHeight: number
  date: number

  // Transaction info:
  txid: string
  signedTx: string
  ourReceiveAddresses: string[]

  // Spend-specific metadata:
  deviceDescription?: string
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom'
  requestedCustomFee?: JsonObject
  feeRateUsed?: JsonObject
  spendTargets?: Array<{
    readonly currencyCode: string
    readonly memo: string | undefined
    readonly nativeAmount: string
    readonly publicAddress: string

    /** @deprecated Use memo instead */
    uniqueIdentifier: string | undefined
  }>
  swapData?: EdgeTxSwap
  txSecret?: string // Monero decryption key

  /**
   * True if the user themselves signed & sent this transaction.
   * This will not be true for transactions created by other users,
   * smart contracts, assets becoming unstaked, or anything else automatic.
   * A send doesn't necessarily spend money, although it often does.
   */
  isSend: boolean

  // Core:
  metadata?: EdgeMetadata
  walletId: string
  otherParams?: JsonObject

  /** @deprecated This will always be undefined */
  wallet?: EdgeCurrencyWallet // eslint-disable-line no-use-before-define
}

export interface EdgeSpendTarget {
  memo?: string
  nativeAmount?: string
  otherParams?: JsonObject
  publicAddress?: string

  /** @deprecated Use memo instead */
  uniqueIdentifier?: string // Use memo instead.
}

export interface EdgePaymentProtocolInfo {
  domain: string
  memo: string
  merchant: string
  nativeAmount: string
  spendTargets: EdgeSpendTarget[]
}

export interface EdgeSpendInfo {
  // Basic information:
  tokenId?: string
  privateKeys?: string[]
  spendTargets: EdgeSpendTarget[]

  // Options:
  noUnconfirmed?: boolean
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom'
  customNetworkFee?: JsonObject // Some kind of currency-specific JSON
  pendingTxs?: EdgeTransaction[]
  rbfTxid?: string
  skipChecks?: boolean

  // Core:
  metadata?: EdgeMetadata
  swapData?: EdgeTxSwap
  otherParams?: JsonObject

  /** @deprecated Use tokenId instead */
  currencyCode?: string
}

// query data ----------------------------------------------------------

export interface EdgeDataDump {
  walletId: string
  walletType: string
  data: {
    [dataCache: string]: JsonObject
  }
}

export interface EdgeFreshAddress {
  publicAddress: string
  segwitAddress?: string
  legacyAddress?: string
  nativeBalance?: string
  segwitNativeBalance?: string
  legacyNativeBalance?: string
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
export interface EdgeStakingStatus {
  // Funds can be in various stages of being locked or unlocked,
  // so each row can describe a single batch of locked coins.
  // Adding together the rows in this array should give the
  // total amount of locked-up funds in the wallet:
  stakedAmounts: Array<{
    nativeAmount: string

    // Maybe these funds are not the chain's parent currency:
    // tokenId?: string,

    // Maybe these funds are being unlocked?
    unlockDate?: Date

    // Feel free to add other weird coin states here.
    // We can standardize them later if they are common:
    otherParams?: JsonObject
  }>
}

export interface EdgeTxidMap {
  [txid: string]: number
}

// URI -----------------------------------------------------------------

export interface WalletConnect {
  uri: string
  topic: string
  version?: string
  bridge?: string
  key?: string
}

export interface EdgeParsedUri {
  bitIDCallbackUri?: string
  bitIDDomain?: string
  bitidKycProvider?: string // Experimental
  bitidKycRequest?: string // Experimental
  bitidPaymentAddress?: string // Experimental
  bitIDURI?: string
  currencyCode?: string
  expireDate?: Date
  legacyAddress?: string
  metadata?: EdgeMetadata
  minNativeAmount?: string
  nativeAmount?: string
  paymentProtocolUrl?: string
  privateKeys?: string[]
  publicAddress?: string
  returnUri?: string
  segwitAddress?: string
  token?: EdgeMetaToken
  uniqueIdentifier?: string // Ripple payment id
  walletConnect?: WalletConnect
}

export interface EdgeEncodeUri {
  publicAddress: string
  nativeAmount?: string
  label?: string
  message?: string
  currencyCode?: string
}

// options -------------------------------------------------------------

export interface EdgeCurrencyCodeOptions {
  currencyCode?: string
}

export interface EdgeGetTransactionsOptions {
  currencyCode?: string
  startIndex?: number
  startEntries?: number
  startDate?: Date
  endDate?: Date
  searchString?: string
  returnIndex?: number
  returnEntries?: number
  denomination?: string
}

export type EdgeGetReceiveAddressOptions = EdgeCurrencyCodeOptions & {
  forceIndex?: number
}

export interface EdgeEngineActivationOptions {
  // If null, activate parent wallet:
  activateTokenIds?: string[]

  // Wallet if the user is paying with a different currency:
  paymentWallet?: EdgeCurrencyWallet
  paymentTokenId?: string
}

export interface EdgeEngineGetActivationAssetsOptions {
  // All wallets in the users account. This allows the engine to choose
  // which wallets can fulfill this activation request
  currencyWallets: { [walletId: string]: EdgeCurrencyWallet }

  // If null, activate parent wallet:
  activateTokenIds?: string[]
}

export interface EdgeEnginePrivateKeyOptions {
  privateKeys?: JsonObject
}

export interface EdgeSignMessageOptions {
  otherParams?: JsonObject
}

// engine --------------------------------------------------------------

export interface EdgeCurrencyEngineCallbacks {
  readonly onAddressChanged: () => void
  readonly onAddressesChecked: (progressRatio: number) => void
  readonly onBalanceChanged: (
    currencyCode: string,
    nativeBalance: string
  ) => void
  readonly onStakingStatusChanged: (status: EdgeStakingStatus) => void
  readonly onTransactionsChanged: (transactions: EdgeTransaction[]) => void
  readonly onTxidsChanged: (txids: EdgeTxidMap) => void
  readonly onUnactivatedTokenIdsChanged: (unactivatedTokenIds: string[]) => void
  readonly onWcNewContractCall: (payload: JsonObject) => void

  /** @deprecated onTransactionsChanged handles confirmation changes */
  readonly onBlockHeightChanged: (blockHeight: number) => void
}

export interface EdgeCurrencyEngineOptions {
  callbacks: EdgeCurrencyEngineCallbacks

  // Wallet-scoped IO objects:
  log: EdgeLog
  walletLocalDisklet: Disklet
  walletLocalEncryptedDisklet: Disklet

  // User settings:
  customTokens: EdgeTokenMap
  enabledTokenIds: string[]
  userSettings: JsonObject | undefined
}

export interface EdgeCurrencyEngine {
  readonly changeUserSettings: (settings: JsonObject) => Promise<void>

  // Engine status:
  readonly startEngine: () => Promise<void>
  readonly killEngine: () => Promise<void>
  readonly resyncBlockchain: () => Promise<void>
  readonly syncNetwork?: (opts: EdgeEnginePrivateKeyOptions) => Promise<number>
  readonly dumpData: () => Promise<EdgeDataDump>

  // Chain state:
  readonly getBlockHeight: () => number
  readonly getBalance: (opts: EdgeCurrencyCodeOptions) => string
  readonly getNumTransactions: (opts: EdgeCurrencyCodeOptions) => number
  readonly getTransactions: (
    opts: EdgeGetTransactionsOptions
  ) => Promise<EdgeTransaction[]>
  readonly getTxids?: () => EdgeTxidMap

  // Tokens:
  readonly changeCustomTokens?: (tokens: EdgeTokenMap) => Promise<void>
  readonly changeEnabledTokenIds?: (tokenIds: string[]) => Promise<void>

  // Asset activation:
  readonly engineGetActivationAssets?: (
    options: EdgeEngineGetActivationAssetsOptions
  ) => Promise<EdgeGetActivationAssetsResults>
  readonly engineActivateWallet?: (
    options: EdgeEngineActivationOptions
  ) => Promise<EdgeActivationQuote>

  // Addresses:
  readonly getFreshAddress: (
    opts: EdgeGetReceiveAddressOptions
  ) => Promise<EdgeFreshAddress>
  readonly addGapLimitAddresses: (addresses: string[]) => Promise<void>
  readonly isAddressUsed: (address: string) => Promise<boolean>

  // Spending:
  readonly getMaxSpendable?: (
    spendInfo: EdgeSpendInfo,
    opts?: EdgeEnginePrivateKeyOptions
  ) => Promise<string>
  readonly makeSpend: (
    spendInfo: EdgeSpendInfo,
    opts?: EdgeEnginePrivateKeyOptions
  ) => Promise<EdgeTransaction>
  readonly signTx: (
    transaction: EdgeTransaction,
    privateKeys: JsonObject
  ) => Promise<EdgeTransaction>
  readonly broadcastTx: (
    transaction: EdgeTransaction,
    opts?: EdgeEnginePrivateKeyOptions
  ) => Promise<EdgeTransaction>
  readonly saveTx: (transaction: EdgeTransaction) => Promise<void>
  readonly sweepPrivateKeys?: (
    spendInfo: EdgeSpendInfo
  ) => Promise<EdgeTransaction>
  readonly getPaymentProtocolInfo?: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>

  // Signing:
  readonly signMessage?: (
    message: string,
    privateKeys: JsonObject,
    opts: EdgeSignMessageOptions
  ) => Promise<string>

  // Accelerating:
  readonly accelerate?: (tx: EdgeTransaction) => Promise<EdgeTransaction | null>

  // Staking:
  readonly getStakingStatus?: () => Promise<EdgeStakingStatus>

  // Escape hatch:
  readonly otherMethods?: EdgeOtherMethods

  /** @deprecated Replaced by changeEnabledTokenIds */
  readonly enableTokens?: (tokens: string[]) => Promise<void>

  /** @deprecated Replaced by changeEnabledTokenIds */
  readonly disableTokens?: (tokens: string[]) => Promise<void>

  /** @deprecated No longer used */
  readonly getEnabledTokens?: () => Promise<string[]>

  /** @deprecated Replaced by changeCustomTokens */
  readonly addCustomToken?: (token: EdgeTokenInfo & EdgeToken) => Promise<void>

  /** @deprecated No longer used */
  readonly getTokenStatus?: (token: string) => boolean

  /** @deprecated Provide EdgeCurrencyTools.getDisplayPrivateKey: */
  readonly getDisplayPrivateSeed?: (privateKeys: JsonObject) => string | null

  /** @deprecated Provide EdgeCurrencyTools.getDisplayPublicKey: */
  readonly getDisplayPublicSeed?: () => string | null
}

// currency plugin -----------------------------------------------------

export interface EdgeMemoRules {
  passed: boolean
  tooLarge?: boolean // Too large numerically
  tooLong?: boolean // Too many characters
  invalidCharacters?: boolean // Wrong character types
}

export interface EdgeCurrencyTools {
  // Keys:
  readonly checkPublicKey?: (publicKey: JsonObject) => Promise<boolean>
  readonly createPrivateKey: (
    walletType: string,
    opts?: JsonObject
  ) => Promise<JsonObject>
  readonly derivePublicKey: (
    privateWalletInfo: EdgeWalletInfo
  ) => Promise<JsonObject>
  readonly getDisplayPrivateKey?: (
    privateWalletInfo: EdgeWalletInfo
  ) => Promise<string>
  readonly getDisplayPublicKey?: (
    publicWalletInfo: EdgeWalletInfo
  ) => Promise<string>
  readonly getSplittableTypes?: (
    publicWalletInfo: EdgeWalletInfo
  ) => string[] | Promise<string[]>
  readonly importPrivateKey?: (
    key: string,
    opts?: JsonObject
  ) => Promise<JsonObject>

  // Derives a tokenId string from a token's network information:
  readonly getTokenId?: (token: EdgeToken) => Promise<string>

  // URIs:
  readonly parseUri: (
    uri: string,
    currencyCode?: string,
    customTokens?: EdgeMetaToken[]
  ) => Promise<EdgeParsedUri>
  readonly encodeUri: (
    obj: EdgeEncodeUri,
    customTokens?: EdgeMetaToken[]
  ) => Promise<string>

  // Transaction memos:
  readonly validateMemo?: (memo: string) => Promise<EdgeMemoRules>
}

export interface EdgeCurrencyPlugin {
  readonly currencyInfo: EdgeCurrencyInfo

  readonly getBuiltinTokens?: () => Promise<EdgeTokenMap>
  readonly makeCurrencyTools: () => Promise<EdgeCurrencyTools>
  readonly makeCurrencyEngine: (
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ) => Promise<EdgeCurrencyEngine>

  // Escape hatch:
  readonly otherMethods?: EdgeOtherMethods
}

// wallet --------------------------------------------------------------

export interface EdgeBalances {
  [currencyCode: string]: string
}

export type EdgeReceiveAddress = EdgeFreshAddress & {
  metadata: EdgeMetadata
  nativeAmount: string
}

export interface EdgeCurrencyWalletEvents {
  close: void
  newTransactions: EdgeTransaction[]
  addressChanged: void
  transactionsChanged: EdgeTransaction[]
  wcNewContractCall: JsonObject
}

export interface EdgeGetActivationAssetsOptions {
  activateWalletId: string
  // If null, activate parent wallet:
  activateTokenIds?: string[]
}

export interface EdgeGetActivationAssetsResults {
  assetOptions: Array<{
    paymentWalletId?: string // If walletId is present, use MUST activate with this wallet
    currencyPluginId: string
    tokenId?: string
  }>
}

export interface EdgeActivationOptions {
  activateWalletId: string
  // If null, activate parent wallet:
  activateTokenIds?: string[]

  // Wallet if the user is paying with a different currency:
  paymentWalletId?: string
  paymentTokenId?: string
}

export interface EdgeActivationApproveOptions {
  metadata?: EdgeMetadata
}

export interface EdgeActivationResult {
  readonly transactions: EdgeTransaction[]
}

export interface EdgeActivationQuote {
  readonly paymentWalletId: string
  readonly paymentTokenId?: string

  readonly fromNativeAmount: string
  readonly networkFee: EdgeNetworkFee2

  readonly approve: (
    opts?: EdgeActivationApproveOptions
  ) => Promise<EdgeActivationResult>
  close: () => Promise<void>
}

export interface EdgeCurrencyWallet {
  readonly on: Subscriber<EdgeCurrencyWalletEvents>
  readonly watch: Subscriber<EdgeCurrencyWallet>

  // Data store:
  readonly disklet: Disklet
  readonly id: string
  readonly localDisklet: Disklet
  readonly publicWalletInfo: EdgeWalletInfo
  readonly sync: () => Promise<void>
  readonly type: string

  // Wallet name:
  readonly name: string | null
  readonly renameWallet: (name: string) => Promise<void>

  // Fiat currency option:
  readonly fiatCurrencyCode: string
  readonly setFiatCurrencyCode: (fiatCurrencyCode: string) => Promise<void>

  // Currency info:
  readonly currencyConfig: EdgeCurrencyConfig // eslint-disable-line no-use-before-define
  readonly currencyInfo: EdgeCurrencyInfo
  readonly denominationToNative: (
    denominatedAmount: string,
    currencyCode: string
  ) => Promise<string>
  readonly nativeToDenomination: (
    nativeAmount: string,
    currencyCode: string
  ) => Promise<string>
  readonly validateMemo: (memo: string) => Promise<EdgeMemoRules>

  // Chain state:
  readonly balances: EdgeBalances
  readonly blockHeight: number
  readonly syncRatio: number
  readonly unactivatedTokenIds: string[]

  // Running state:
  readonly changePaused: (paused: boolean) => Promise<void>
  readonly paused: boolean

  // Token management:
  // Available tokens can be found in `EdgeCurrencyConfig`.
  // This list is allowed to include missing or deleted `tokenIds`:
  readonly changeEnabledTokenIds: (tokenIds: string[]) => Promise<void>
  readonly enabledTokenIds: string[]

  // Transaction history:
  readonly getNumTransactions: (
    opts?: EdgeCurrencyCodeOptions
  ) => Promise<number>
  readonly getTransactions: (
    opts?: EdgeGetTransactionsOptions
  ) => Promise<EdgeTransaction[]>

  // Addresses:
  readonly getReceiveAddress: (
    opts?: EdgeGetReceiveAddressOptions
  ) => Promise<EdgeReceiveAddress>
  readonly lockReceiveAddress: (
    receiveAddress: EdgeReceiveAddress
  ) => Promise<void>
  readonly saveReceiveAddress: (
    receiveAddress: EdgeReceiveAddress
  ) => Promise<void>

  // Sending:
  readonly broadcastTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>
  readonly getMaxSpendable: (spendInfo: EdgeSpendInfo) => Promise<string>
  readonly getPaymentProtocolInfo: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>
  readonly makeSpend: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>
  readonly saveTx: (tx: EdgeTransaction) => Promise<void>
  readonly saveTxMetadata: (
    txid: string,
    currencyCode: string,
    metadata: EdgeMetadata
  ) => Promise<void>
  readonly signTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>
  readonly sweepPrivateKeys: (
    edgeSpendInfo: EdgeSpendInfo
  ) => Promise<EdgeTransaction>

  // Signing:
  readonly signMessage: (
    message: string,
    opts?: EdgeSignMessageOptions
  ) => Promise<string>

  // Accelerating:
  readonly accelerate: (tx: EdgeTransaction) => Promise<EdgeTransaction | null>

  // Staking:
  readonly stakingStatus: EdgeStakingStatus

  // Wallet management:
  readonly dumpData: () => Promise<EdgeDataDump>
  readonly resyncBlockchain: () => Promise<void>

  // URI handling:
  readonly encodeUri: (obj: EdgeEncodeUri) => Promise<string>
  readonly parseUri: (
    uri: string,
    currencyCode?: string
  ) => Promise<EdgeParsedUri>

  // Generic:
  readonly otherMethods: EdgeOtherMethods

  /** @deprecated Call EdgeCurrencyConfig.addCustomToken instead */
  readonly addCustomToken: (token: EdgeTokenInfo) => Promise<void>

  /** @deprecated Call changeEnabledTokenIds instead */
  readonly changeEnabledTokens: (currencyCodes: string[]) => Promise<void>

  /** @deprecated Call changeEnabledTokenIds instead */
  readonly disableTokens: (tokens: string[]) => Promise<void>

  /** @deprecated Call changeEnabledTokenIds instead */
  readonly enableTokens: (tokens: string[]) => Promise<void>

  /** @deprecated Read enabledTokenIds instead */
  readonly getEnabledTokens: () => Promise<string[]>

  /** @deprecated Call `EdgeAccount.getDisplayPrivateKey` instead */
  readonly displayPrivateSeed: string | null

  /** @deprecated Call `EdgeAccount.getDisplayPublicKey` instead */
  readonly displayPublicSeed: string | null

  /** @deprecated Call `EdgeAccount.getRawPrivateKey` instead */
  readonly keys: JsonObject
}

// ---------------------------------------------------------------------
// swap plugin
// ---------------------------------------------------------------------

export type EdgeSwapPluginType = 'DEX' | 'CEX'

/**
 * Static data about a swap plugin.
 */
export interface EdgeSwapInfo {
  readonly pluginId: string
  readonly displayName: string
  readonly isDex?: boolean

  readonly orderUri?: string // The orderId would be appended to this
  readonly supportEmail: string
}

export interface EdgeSwapRequest {
  // Where?
  fromWallet: EdgeCurrencyWallet
  toWallet: EdgeCurrencyWallet

  // What?
  fromTokenId?: string
  toTokenId?: string

  // How much?
  nativeAmount: string
  quoteFor: 'from' | 'max' | 'to'

  /** @deprecated Use fromTokenId instead */
  fromCurrencyCode?: string

  /** @deprecated Use toTokenId instead */
  toCurrencyCode?: string
}

/**
 * If the user approves a quote, the plugin performs the transaction
 * and returns this as the result.
 */
export interface EdgeSwapResult {
  readonly orderId?: string
  readonly destinationAddress?: string
  readonly transaction: EdgeTransaction
}

export interface EdgeSwapApproveOptions {
  metadata?: EdgeMetadata
}

/**
 * If a provider can satisfy a request, what is their price?
 */
export interface EdgeSwapQuote {
  readonly swapInfo: EdgeSwapInfo
  readonly request: EdgeSwapRequest

  readonly isEstimate: boolean
  readonly fromNativeAmount: string
  readonly toNativeAmount: string
  readonly networkFee: EdgeNetworkFee

  readonly pluginId: string
  readonly expirationDate?: Date

  readonly approve: (opts?: EdgeSwapApproveOptions) => Promise<EdgeSwapResult>
  readonly close: () => Promise<void>
}

export interface EdgeSwapPluginStatus {
  needsActivation?: boolean
}

export interface EdgeSwapPlugin {
  readonly swapInfo: EdgeSwapInfo

  readonly checkSettings?: (userSettings: JsonObject) => EdgeSwapPluginStatus
  readonly fetchSwapQuote: (
    request: EdgeSwapRequest,
    userSettings: JsonObject | undefined,
    opts: { promoCode?: string }
  ) => Promise<EdgeSwapQuote>
}

// ---------------------------------------------------------------------
// rate plugin
// ---------------------------------------------------------------------

export interface EdgeRateHint {
  fromCurrency: string
  toCurrency: string
}

export interface EdgeRateInfo {
  readonly pluginId: string
  readonly displayName: string
}

export interface EdgeRatePair {
  fromCurrency: string
  toCurrency: string
  rate: number
}

export interface EdgeRatePlugin {
  readonly rateInfo: EdgeRateInfo

  readonly fetchRates: (hints: EdgeRateHint[]) => Promise<EdgeRatePair[]>
}

// ---------------------------------------------------------------------
// account
// ---------------------------------------------------------------------

export interface EdgeAccountOptions {
  now?: Date // The current time, if different from `new Date()`
  otpKey?: string // The OTP secret
  otp?: string // The 6-digit OTP, or (deprecated) the OTP secret
  pauseWallets?: boolean // True to start wallets in the paused state
}

/**
 * A pending request to log in from a new device.
 */
export interface EdgePendingVoucher {
  voucherId: string
  activates: Date
  created: Date
  deviceDescription?: string
  ip: string
  ipDescription: string
}

// currencies ----------------------------------------------------------

export interface EdgeCreateCurrencyWalletOptions {
  fiatCurrencyCode?: string
  name?: string

  // Create a private key from some text:
  importText?: string

  // Used to tell the currency plugin what keys to create:
  keyOptions?: JsonObject

  // Used to copy wallet keys between accounts:
  keys?: JsonObject

  // Set if we are sweeping one wallet into another:
  migratedFromWalletId?: string
}

export interface EdgeCurrencyConfig {
  readonly watch: Subscriber<EdgeCurrencyConfig>

  readonly currencyInfo: EdgeCurrencyInfo

  // Tokens:
  readonly allTokens: EdgeTokenMap
  readonly builtinTokens: EdgeTokenMap
  readonly customTokens: EdgeTokenMap
  readonly addCustomToken: (token: EdgeToken) => Promise<string>
  readonly changeCustomToken: (
    tokenId: string,
    token: EdgeToken
  ) => Promise<void>
  readonly removeCustomToken: (tokenId: string) => Promise<void>

  // Always-enabled tokens:
  readonly alwaysEnabledTokenIds: string[]
  readonly changeAlwaysEnabledTokenIds: (tokenIds: string[]) => Promise<void>

  // User settings for this plugin:
  readonly userSettings: JsonObject | undefined
  readonly changeUserSettings: (settings: JsonObject) => Promise<void>

  // Utility methods:
  readonly importKey: (
    userInput: string,
    opts?: { keyOptions?: JsonObject }
  ) => Promise<JsonObject>
  readonly otherMethods: EdgeOtherMethods
}

export interface EthereumTransaction {
  chainId: number // Not part of raw data, but needed for signing
  nonce: string
  gasPrice: string
  gasLimit: string
  to: string
  value: string
  data: string
  // The transaction is unsigned, so these are not present:
  v?: string
  r?: string
  s?: string
}

// rates ---------------------------------------------------------------

export interface EdgeRateCacheEvents {
  close: void
  update: unknown
}

export interface EdgeConvertCurrencyOpts {
  biases?: { [name: string]: number }
}

export interface EdgeRateCache {
  readonly on: Subscriber<EdgeRateCacheEvents>

  readonly convertCurrency: (
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
export interface EdgeSwapConfig {
  readonly watch: Subscriber<EdgeSwapConfig>

  readonly enabled: boolean
  readonly needsActivation: boolean
  readonly swapInfo: EdgeSwapInfo
  readonly userSettings: JsonObject | undefined

  readonly changeEnabled: (enabled: boolean) => Promise<void>
  readonly changeUserSettings: (settings: JsonObject) => Promise<void>
}

export interface EdgeSwapRequestOptions {
  preferPluginId?: string
  preferType?: EdgeSwapPluginType
  disabled?: EdgePluginMap<true>
  promoCodes?: EdgePluginMap<string>
}

// edge login ----------------------------------------------------------

export interface EdgeLoginRequest {
  readonly appId: string

  readonly displayName: string
  readonly displayImageDarkUrl?: string
  readonly displayImageLightUrl?: string

  readonly approve: () => Promise<void>
  readonly close: () => Promise<void>

  /** @deprecated Use displayImageDarkUrl or displayImageLightUrl instead */
  readonly displayImageUrl?: string
}

export interface EdgeLobby {
  readonly loginRequest: EdgeLoginRequest | undefined
  // walletRequest: EdgeWalletRequest | undefined
}

// storage -------------------------------------------------------------

export interface EdgeDataStore {
  readonly deleteItem: (storeId: string, itemId: string) => Promise<void>
  readonly deleteStore: (storeId: string) => Promise<void>

  readonly listItemIds: (storeId: string) => Promise<string[]>
  readonly listStoreIds: () => Promise<string[]>

  readonly getItem: (storeId: string, itemId: string) => Promise<string>
  readonly setItem: (
    storeId: string,
    itemId: string,
    value: string
  ) => Promise<void>
}

// account -------------------------------------------------------------

export interface EdgeAccountEvents {
  close: void
}

export interface EdgeAccount {
  readonly on: Subscriber<EdgeAccountEvents>
  readonly watch: Subscriber<EdgeAccount>

  // Data store:
  readonly id: string
  readonly type: string
  readonly disklet: Disklet
  readonly localDisklet: Disklet
  readonly sync: () => Promise<void>

  // Basic login information:
  readonly appId: string
  readonly created: Date | undefined // Not always known
  readonly lastLogin: Date
  readonly loggedIn: boolean
  readonly loginKey: string // base58
  readonly recoveryKey: string | undefined // base58, for email backup
  readonly rootLoginId: string // base58
  readonly username: string

  // Special-purpose API's:
  readonly currencyConfig: EdgePluginMap<EdgeCurrencyConfig>
  readonly rateCache: EdgeRateCache
  readonly swapConfig: EdgePluginMap<EdgeSwapConfig>
  readonly dataStore: EdgeDataStore

  // What login method was used?
  readonly edgeLogin: boolean
  readonly keyLogin: boolean
  readonly newAccount: boolean
  readonly passwordLogin: boolean
  readonly pinLogin: boolean
  readonly recoveryLogin: boolean

  // Change or create credentials:
  readonly changePassword: (password: string) => Promise<void>
  readonly changePin: (opts: {
    pin?: string // We keep the existing PIN if unspecified
    enableLogin?: boolean // We default to true if unspecified
  }) => Promise<string>
  readonly changeRecovery: (
    questions: string[],
    answers: string[]
  ) => Promise<string>

  // Verify existing credentials:
  readonly checkPassword: (password: string) => Promise<boolean>
  readonly checkPin: (pin: string) => Promise<boolean>

  // Remove credentials:
  readonly deletePassword: () => Promise<void>
  readonly deletePin: () => Promise<void>
  readonly deleteRecovery: () => Promise<void>

  // OTP:
  readonly otpKey: string | undefined // OTP is enabled if this exists
  readonly otpResetDate: Date | undefined // A reset is requested if this exists
  readonly cancelOtpReset: () => Promise<void>
  readonly disableOtp: () => Promise<void>
  readonly enableOtp: (timeout?: number) => Promise<void>
  readonly repairOtp: (otpKey: string) => Promise<void>

  // 2fa bypass voucher approval / rejection:
  readonly pendingVouchers: EdgePendingVoucher[]
  readonly approveVoucher: (voucherId: string) => Promise<void>
  readonly rejectVoucher: (voucherId: string) => Promise<void>

  // Edge login approval:
  readonly fetchLobby: (lobbyId: string) => Promise<EdgeLobby>

  // Login management:
  readonly deleteRemoteAccount: () => Promise<void>
  readonly logout: () => Promise<void>

  // Master wallet list:
  readonly allKeys: EdgeWalletInfoFull[]
  readonly changeWalletStates: (walletStates: EdgeWalletStates) => Promise<void>
  readonly createWallet: (type: string, keys?: JsonObject) => Promise<string>
  readonly getFirstWalletInfo: (type: string) => EdgeWalletInfo | undefined
  readonly getWalletInfo: (id: string) => EdgeWalletInfo | undefined
  readonly listWalletIds: () => string[]
  readonly listSplittableWalletTypes: (walletId: string) => Promise<string[]>
  readonly splitWalletInfo: (
    walletId: string,
    newWalletType: string
  ) => Promise<string>

  // Key access:
  readonly getDisplayPrivateKey: (walletId: string) => Promise<string>
  readonly getDisplayPublicKey: (walletId: string) => Promise<string>
  readonly getRawPrivateKey: (walletId: string) => Promise<JsonObject>
  readonly getRawPublicKey: (walletId: string) => Promise<JsonObject>

  // Currency wallets:
  readonly activeWalletIds: string[]
  readonly archivedWalletIds: string[]
  readonly hiddenWalletIds: string[]
  readonly currencyWallets: { [walletId: string]: EdgeCurrencyWallet }
  readonly currencyWalletErrors: { [walletId: string]: Error }
  readonly createCurrencyWallet: (
    type: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ) => Promise<EdgeCurrencyWallet>
  readonly waitForCurrencyWallet: (
    walletId: string
  ) => Promise<EdgeCurrencyWallet>
  readonly waitForAllWallets: () => Promise<void>

  // Token & wallet activation:
  readonly getActivationAssets: (
    options: EdgeGetActivationAssetsOptions
  ) => Promise<EdgeGetActivationAssetsResults>
  readonly activateWallet: (
    options: EdgeActivationOptions
  ) => Promise<EdgeActivationQuote>

  // Web compatibility:
  readonly signEthereumTransaction: (
    walletId: string,
    transaction: EthereumTransaction
  ) => Promise<string>

  // Swapping:
  readonly fetchSwapQuote: (
    request: EdgeSwapRequest,
    opts?: EdgeSwapRequestOptions
  ) => Promise<EdgeSwapQuote>

  /** @deprecated Use `EdgeAccount.getRawPrivateKey` */
  readonly keys: JsonObject
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

export interface EdgeContextOptions {
  apiKey: string
  appId: string
  authServer?: string
  hideKeys?: boolean

  // Intercepts crash reports:
  crashReporter?: EdgeCrashReporter

  // A string to describe this phone or app:
  deviceDescription?: string

  // Intercepts all console logging:
  onLog?: EdgeOnLog
  logSettings?: Partial<EdgeLogSettings>

  path?: string // Only used on node.js
  plugins?: EdgeCorePluginsInit
}

export interface EdgeRecoveryQuestionChoice {
  category: 'address' | 'must' | 'numeric' | 'recovery2' | 'string'
  min_length: number
  question: string
}

// parameters ----------------------------------------------------------

export interface EdgeLoginMessage {
  loginId: string // base64
  otpResetPending: boolean
  pendingVouchers: EdgePendingVoucher[]
  recovery2Corrupt: boolean
  username: string
}

export interface EdgeLoginMessages {
  [username: string]: EdgeLoginMessage
}

export interface EdgePasswordRules {
  secondsToCrack: number
  tooShort: boolean
  noNumber: boolean
  noLowerCase: boolean
  noUpperCase: boolean
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
export interface EdgePendingEdgeLogin {
  readonly watch: Subscriber<EdgePendingEdgeLogin>
  readonly id: string

  readonly state: 'pending' | 'started' | 'done' | 'error' | 'closed'
  readonly username?: string // Set in the "started" state
  readonly account?: EdgeAccount // Set in the "done" state
  readonly error?: unknown // Set in the "error" state

  readonly cancelRequest: () => Promise<void>
}

export interface EdgeUserInfo {
  keyLoginEnabled: boolean
  lastLogin?: Date
  loginId: string // base58
  pinLoginEnabled: boolean
  recovery2Key?: string // base58
  username: string
  voucherId?: string
}

// context -------------------------------------------------------------

export interface EdgeContextEvents {
  close: void
  error: Error
}

export interface EdgeContext {
  readonly on: Subscriber<EdgeContextEvents>
  readonly watch: Subscriber<EdgeContext>
  readonly close: () => Promise<void>

  readonly appId: string
  readonly clientId: string // Unique ID for each app installation

  // Local user management:
  localUsers: EdgeUserInfo[]
  readonly fixUsername: (username: string) => string
  readonly listUsernames: () => Promise<string[]>
  readonly deleteLocalAccount: (username: string) => Promise<void>

  // Account creation:
  readonly usernameAvailable: (username: string) => Promise<boolean>
  readonly createAccount: (
    username: string,
    password?: string,
    pin?: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // Edge login:
  readonly requestEdgeLogin: (
    opts?: EdgeAccountOptions
  ) => Promise<EdgePendingEdgeLogin>

  // Fingerprint login:
  readonly loginWithKey: (
    username: string,
    loginKey: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // Password login:
  readonly checkPasswordRules: (password: string) => EdgePasswordRules
  readonly loginWithPassword: (
    username: string,
    password: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // PIN login:
  readonly pinLoginEnabled: (username: string) => Promise<boolean>
  readonly loginWithPIN: (
    username: string,
    pin: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // Recovery2 login:
  readonly loginWithRecovery2: (
    recovery2Key: string,
    username: string,
    answers: string[],
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>
  readonly fetchRecovery2Questions: (
    recovery2Key: string,
    username: string
  ) => Promise<string[]>
  // Really returns EdgeRecoveryQuestionChoice[]:
  readonly listRecoveryQuestionChoices: () => Promise<any>

  // OTP stuff:
  readonly requestOtpReset: (
    username: string,
    otpResetToken: string
  ) => Promise<Date>
  readonly fetchLoginMessages: () => Promise<EdgeLoginMessages>

  // Background mode:
  readonly paused: boolean
  readonly changePaused: (
    paused: boolean,
    opts?: { secondsDelay?: number }
  ) => Promise<void>

  // Logging options:
  readonly logSettings: EdgeLogSettings
  readonly changeLogSettings: (
    settings: Partial<EdgeLogSettings>
  ) => Promise<void>
}

// ---------------------------------------------------------------------
// fake mode
// ---------------------------------------------------------------------

export interface EdgeFakeWorldOptions {
  crashReporter?: EdgeCrashReporter
  onLog?: EdgeOnLog
}

export interface EdgeFakeContextOptions {
  // EdgeContextOptions:
  apiKey: string
  appId: string
  deviceDescription?: string
  hideKeys?: boolean
  logSettings?: Partial<EdgeLogSettings>
  plugins?: EdgeCorePluginsInit

  // Allows core plugins to access the real network except for the
  // login and sync servers, which remain emulated:
  allowNetworkAccess?: boolean

  // Fake device options:
  cleanDevice?: boolean
}

/**
 * A block of JSON data that can be used to save & restore a user
 * on the fake unit-testing server.
 */
export interface EdgeFakeUser {
  username: string
  lastLogin?: Date
  loginId: string // base64
  loginKey: string // base64
  repos: { [repo: string]: { [path: string]: any /* asEdgeBox */ } }
  server: any // asLoginDump
}

export interface EdgeFakeWorld {
  readonly close: () => Promise<void>

  readonly makeEdgeContext: (
    opts: EdgeFakeContextOptions
  ) => Promise<EdgeContext>

  readonly goOffline: (offline?: boolean) => Promise<void>
  readonly dumpFakeUser: (account: EdgeAccount) => Promise<EdgeFakeUser>
}

// ---------------------------------------------------------------------
// deprecated types
// ---------------------------------------------------------------------

export interface EdgeNetworkFee {
  readonly currencyCode: string
  readonly nativeAmount: string
}

export interface EdgeBitcoinPrivateKeyOptions {
  format?: string
  coinType?: number
  account?: number
}

export type EdgeCreatePrivateKeyOptions =
  | EdgeBitcoinPrivateKeyOptions
  | JsonObject

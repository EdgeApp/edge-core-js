import type { Disklet } from 'disklet'
import type {
  FetchFunction,
  FetchHeaders,
  FetchOptions,
  FetchResponse
} from 'serverlet'
import type { Subscriber } from 'yaob'

export * from './error'
export * from './fake-types'
export * from './server-cleaners'
export * from './server-types'

// ---------------------------------------------------------------------
// helper types
// ---------------------------------------------------------------------

/** A JSON object (as opposed to an array or primitive). */
export interface JsonObject {
  [name: string]: any // TODO: this needs to become `unknown`
}

/** When we return errors explicitly instead of throwing them */
export type EdgeResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: unknown }

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

  /**
   * This is like `fetch`, but will try to avoid CORS limitations
   * on platforms where that may be a problem.
   */
  readonly fetchCors: EdgeFetchFunction
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
  /** Load-time options (like API keys) passed into the context */
  initOptions: JsonObject

  /** Data provided by the info server */
  infoPayload: JsonObject

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
  created?: Date
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

/**
 * Different currencies support different types of on-chain memos,
 * so this structure describes the options that are available,
 * along with the applicable limits.
 */
export type EdgeMemoOption =
  | {
      type: 'text'
      hidden?: boolean
      memoName?: string

      /**  Maximum number of text characters */
      maxLength?: number
    }
  | {
      type: 'number'
      hidden?: boolean
      memoName?: string

      /**
       * Maximum numerical value.
       * Numbers are passed as decimal strings.
       */
      maxValue?: string
    }
  | {
      type: 'hex'
      hidden?: boolean
      memoName?: string

      /** Number of hexadecimal bytes. */
      maxBytes?: number
      minBytes?: number
    }

export interface EdgeMemo {
  type: 'text' | 'number' | 'hex'
  value: string

  /** Should we hide this from the user, such as for OP_RETURN? */
  hidden?: boolean

  /** What does the chain call this? Defaults to "memo". */
  memoName?: string
}

export interface EdgeAssetAmount {
  pluginId: string
  tokenId: EdgeTokenId
  nativeAmount?: string
}

export interface EdgeFiatAmount {
  // core-js style fiat code including 'iso:'
  fiatCurrencyCode: string
  fiatAmount: string
}

export interface EdgeTxActionSwap {
  actionType: 'swap'
  swapInfo: EdgeSwapInfo
  orderId?: string
  orderUri?: string
  isEstimate?: boolean
  canBePartial?: boolean
  fromAsset: EdgeAssetAmount
  toAsset: EdgeAssetAmount
  payoutAddress: string
  payoutWalletId: string
  refundAddress?: string
}

export interface EdgeTxActionStake {
  actionType: 'stake'
  pluginId: string
  stakeAssets: EdgeAssetAmount[]
}

export interface EdgeTxActionFiat {
  actionType: 'fiat'

  orderId: string
  orderUri?: string
  isEstimate: boolean

  fiatPlugin: {
    providerId: string
    providerDisplayName: string
    supportEmail?: string
  }

  payinAddress?: string
  payoutAddress?: string
  fiatAsset: EdgeFiatAmount
  cryptoAsset: EdgeAssetAmount
}

export interface EdgeTxActionTokenApproval {
  actionType: 'tokenApproval'
  tokenApproved: EdgeAssetAmount
  tokenContractAddress: string
  contractAddress: string
}

export type EdgeTxAction =
  | EdgeTxActionSwap
  | EdgeTxActionStake
  | EdgeTxActionFiat
  | EdgeTxActionTokenApproval

export interface EdgeTxAmount {
  tokenId: EdgeTokenId
  nativeAmount: string
}

export type EdgeAssetActionType =
  | 'claim'
  | 'claimOrder'
  | 'stake'
  | 'stakeNetworkFee'
  | 'stakeOrder'
  | 'unstake'
  | 'unstakeNetworkFee'
  | 'unstakeOrder'
  | 'swap'
  | 'swapNetworkFee'
  | 'swapOrderPost'
  | 'swapOrderFill'
  | 'swapOrderCancel'
  | 'buy'
  | 'sell'
  | 'sellNetworkFee'
  | 'tokenApproval'
  | 'transfer'
  | 'transferNetworkFee'

export interface EdgeAssetAction {
  assetActionType: EdgeAssetActionType
}

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

/**
 * A normal tokenId (chosen by the currency plugin),
 * or `null` to indicate the parent currency (such as "ETH").
 */
export type EdgeTokenId = string | null

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

export type EdgeObjectTemplate = Array<
  | {
      // Displayed as a decimal number, but saved as an integer string.
      // The multiplier gives the position of the display decimal point.
      // This is only used for custom fees.
      // It is *not* supported for custom tokens:
      type: 'nativeAmount'
      key: string
      displayName: string
      displayMultiplier: string
    }
  | {
      // An integer, saved as a JavaScript `number` type:
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

  /**
   * Lists the types of memos this chain supports.
   * A missing or empty list means no memo support.
   */
  memoOptions?: EdgeMemoOption[]

  /** True if the transaction can have multiple memos at once: */
  multipleMemos?: boolean

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
  defaultSettings?: JsonObject

  /** @deprecated Use EdgeCurrencyPlugin.getBuiltinTokens instead */
  metaTokens?: EdgeMetaToken[]

  /** @deprecated Use memoOptions instead. */
  memoMaxLength?: number // Max number of text characters, if supported

  /** @deprecated Use memoOptions instead. */
  memoMaxValue?: string // Max numerical value, if supported

  /** @deprecated Use memoOptions instead. */
  memoType?: 'text' | 'number' | 'hex' | 'other' // undefined means no memo support
}

// spending ------------------------------------------------------------

export interface EdgeMetadata {
  bizId?: number
  category?: string
  exchangeAmount?: { [fiatCurrencyCode: string]: number }
  name?: string
  notes?: string
}

/**
 * Like EdgeMetadata, but passing `null` will delete a saved value,
 * while passing `undefined` will leave the value unchanged.
 */
export interface EdgeMetadataChange {
  bizId?: number | null
  category?: string | null
  exchangeAmount?: { [fiatCurrencyCode: string]: number | null }
  name?: string | null
  notes?: string | null
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

export type EdgeConfirmationState =
  // More than `EdgeCurrencyInfo.requiredConfirmations`:
  | 'confirmed'
  // Dropped from the network without confirmations:
  | 'dropped'
  // Confirmed, but failed on-chain execution (exceeded gas limit,
  // smart-contract failure, etc):
  | 'failed'
  // We don't know the chain height yet:
  | 'syncing'
  // No confirmations yet:
  | 'unconfirmed'
  // Something between 1 and `requiredConfirmations`.
  // Currency engines can always return a number,
  // and the core will translate it into one of the other states:
  | number

export interface EdgeTransaction {
  /**
   * The asset used to query this transaction.
   * The amounts and metadata will reflect the chosen asset.
   */
  tokenId: EdgeTokenId

  // Amounts:
  nativeAmount: string
  networkFee: string
  networkFees: EdgeTxAmount[]
  parentNetworkFee?: string

  // Confirmation status:
  confirmations?: EdgeConfirmationState
  blockHeight: number
  date: number

  // Transaction info:
  txid: string
  signedTx: string
  memos: EdgeMemo[]
  ourReceiveAddresses: string[]

  /** App-provided per-asset action data */
  assetAction?: EdgeAssetAction

  /** Plugin-provided action data for all assets in a transaction */
  chainAction?: EdgeTxAction

  /** Plugin-provided per-asset action data */
  chainAssetAction?: EdgeAssetAction

  /** App-provided action data for all assets in a transaction */
  savedAction?: EdgeTxAction

  /** This has the same format as the `customNetworkFee` */
  feeRateUsed?: JsonObject

  // Spend-specific metadata:
  deviceDescription?: string
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom'
  requestedCustomFee?: JsonObject
  spendTargets?: Array<{
    readonly currencyCode: string // Saved for future reference
    readonly nativeAmount: string
    readonly publicAddress: string

    /** @deprecated Use `EdgeTransaction.memos` instead */
    readonly memo: string | undefined

    /** @deprecated Use `EdgeTransaction.memos` instead */
    readonly uniqueIdentifier: string | undefined
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

  /** @deprecated Use tokenId instead */
  currencyCode: string
}

export interface EdgeSpendTarget {
  nativeAmount?: string
  otherParams?: JsonObject
  publicAddress?: string

  /** @deprecated. Use `EdgeSpendInfo.memos` instead. */
  memo?: string

  /** @deprecated. Use `EdgeSpendInfo.memos` instead. */
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
  tokenId: EdgeTokenId
  privateKeys?: string[]
  spendTargets: EdgeSpendTarget[]
  memos?: EdgeMemo[]

  // Options:
  noUnconfirmed?: boolean
  networkFeeOption?: 'high' | 'standard' | 'low' | 'custom'
  customNetworkFee?: JsonObject // Some kind of currency-specific JSON
  /** Enables RBF on chains where RBF is optional */
  enableRbf?: boolean
  pendingTxs?: EdgeTransaction[]
  /** @deprecated Use EdgeCurrencyWallet.accelerate instead */
  rbfTxid?: string
  skipChecks?: boolean

  // Core:
  assetAction?: EdgeAssetAction
  savedAction?: EdgeTxAction
  metadata?: EdgeMetadata
  swapData?: EdgeTxSwap
  otherParams?: JsonObject
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
  tokenId?: EdgeTokenId
  uniqueIdentifier?: string // Ripple payment id
  walletConnect?: WalletConnect

  /** @deprecated Use tokenId instead */
  currencyCode?: string
}

export interface EdgeEncodeUri {
  publicAddress: string
  nativeAmount?: string
  label?: string
  message?: string
  currencyCode?: string
}

// options -------------------------------------------------------------

export interface EdgeTokenIdOptions {
  tokenId: EdgeTokenId
}

export interface EdgeGetTransactionsOptions {
  // Filtering:
  startDate?: Date
  endDate?: Date
  searchString?: string
  spamThreshold?: string
  tokenId: EdgeTokenId
}

export interface EdgeStreamTransactionOptions {
  /**
   * The number of entries to return in each batch.
   * Defaults to something reasonable, like 10.
   */
  batchSize?: number

  /**
   * The number entries to return on the first batch.
   * Defaults to `batchSize`.
   */
  firstBatchSize?: number

  /** Only return transactions newer than this date */
  afterDate?: Date

  /** Only return transactions older than this date */
  beforeDate?: Date

  /** Only return transactions matching this string */
  searchString?: string

  /** Filter incoming transactions with a `nativeAmount` below this */
  spamThreshold?: string

  /** The token to query, or undefined for the main currency */
  tokenId: EdgeTokenId
}

export type EdgeGetReceiveAddressOptions = EdgeTokenIdOptions & {
  forceIndex?: number
}

export interface EdgeEngineActivationOptions {
  // If null, activate parent wallet:
  activateTokenIds: EdgeTokenId[]

  // Wallet if the user is paying with a different currency:
  paymentInfo?: {
    wallet: EdgeCurrencyWallet
    tokenId: EdgeTokenId
  }
}

export interface EdgeEngineGetActivationAssetsOptions {
  // All wallets in the users account. This allows the engine to choose
  // which wallets can fulfill this activation request
  currencyWallets: { [walletId: string]: EdgeCurrencyWallet }

  // If null, activate parent wallet:
  activateTokenIds: EdgeTokenId[]
}

export interface EdgeEnginePrivateKeyOptions {
  privateKeys?: JsonObject
}

export interface EdgeSaveTxActionOptions {
  txid: string
  tokenId: EdgeTokenId
  assetAction: EdgeAssetAction
  savedAction: EdgeTxAction
}

export interface EdgeSaveTxMetadataOptions {
  txid: string
  tokenId: EdgeTokenId
  metadata: EdgeMetadataChange
}

export interface EdgeSignMessageOptions {
  otherParams?: JsonObject
}

// engine --------------------------------------------------------------

export interface EdgeCurrencyEngineCallbacks {
  readonly onAddressChanged: () => void
  readonly onAddressesChecked: (progressRatio: number) => void
  readonly onNewTokens: (tokenIds: string[]) => void
  readonly onStakingStatusChanged: (status: EdgeStakingStatus) => void
  readonly onTokenBalanceChanged: (
    tokenId: EdgeTokenId,
    balance: string
  ) => void
  readonly onTransactionsChanged: (transactions: EdgeTransaction[]) => void
  readonly onTxidsChanged: (txids: EdgeTxidMap) => void
  readonly onUnactivatedTokenIdsChanged: (unactivatedTokenIds: string[]) => void
  readonly onWcNewContractCall: (payload: JsonObject) => void

  /** @deprecated onTransactionsChanged handles confirmation changes */
  readonly onBlockHeightChanged: (blockHeight: number) => void

  /** @deprecated Use onTokenBalanceChanged instead */
  readonly onBalanceChanged: (
    currencyCode: string,
    nativeBalance: string
  ) => void
}

export interface EdgeCurrencyEngineOptions {
  callbacks: EdgeCurrencyEngineCallbacks

  /** True if we only need a balance and the ability to spend it. */
  lightMode?: boolean

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
  readonly getBalance: (opts: EdgeTokenIdOptions) => string
  readonly getNumTransactions: (opts: EdgeTokenIdOptions) => number
  readonly getTransactions: (
    opts: EdgeTokenIdOptions
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
  readonly signBytes?: (
    bytes: Uint8Array,
    privateKeys: JsonObject,
    opts: EdgeSignMessageOptions
  ) => Promise<string>

  // Accelerating:
  readonly accelerate?: (tx: EdgeTransaction) => Promise<EdgeTransaction | null>

  // Staking:
  readonly getStakingStatus?: () => Promise<EdgeStakingStatus>

  // Escape hatch:
  readonly otherMethods?: EdgeOtherMethods
  readonly otherMethodsWithKeys?: EdgeOtherMethods

  /** @deprecated Replaced by changeEnabledTokenIds */
  readonly enableTokens?: (tokens: string[]) => Promise<void>

  /** @deprecated Replaced by changeEnabledTokenIds */
  readonly disableTokens?: (tokens: string[]) => Promise<void>

  /** @deprecated Replaced by changeCustomTokens */
  readonly addCustomToken?: (token: EdgeTokenInfo & EdgeToken) => Promise<void>

  /** @deprecated Provide EdgeCurrencyTools.getDisplayPrivateKey: */
  readonly getDisplayPrivateSeed?: (privateKeys: JsonObject) => string | null

  /** @deprecated Provide EdgeCurrencyTools.getDisplayPublicKey: */
  readonly getDisplayPublicSeed?: () => string | null

  /**
   * @deprecated Replaced by `signBytes`.
   * Various plugins implement this function with inconsistent encodings.
   */
  readonly signMessage?: (
    message: string,
    privateKeys: JsonObject,
    opts: EdgeSignMessageOptions
  ) => Promise<string>
}

// currency plugin -----------------------------------------------------

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
  readonly getDisplayPublicKeys?: (publicWalletInfo: EdgeWalletInfo) => {
    [key: string]: string
  }
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
}

export interface EdgeCurrencyPlugin {
  readonly currencyInfo: EdgeCurrencyInfo

  readonly getBuiltinTokens?: () => Promise<EdgeTokenMap>
  readonly makeCurrencyTools: () => Promise<EdgeCurrencyTools>
  readonly makeCurrencyEngine: (
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ) => Promise<EdgeCurrencyEngine>
  readonly updateInfoPayload?: (infoPayload: JsonObject) => Promise<void>

  // Escape hatch:
  readonly otherMethods?: EdgeOtherMethods
}

// wallet --------------------------------------------------------------

export interface EdgeBalances {
  [currencyCode: string]: string
}

export type EdgeBalanceMap = Map<EdgeTokenId, string>

export type EdgeReceiveAddress = EdgeFreshAddress & {
  metadata: EdgeMetadata
  nativeAmount: string
}

export interface EdgeCurrencyWalletEvents {
  addressChanged: void
  close: void
  enabledDetectedTokens: string[]
  newTransactions: EdgeTransaction[]
  transactionsChanged: EdgeTransaction[]
  wcNewContractCall: JsonObject
}

export interface EdgeGetActivationAssetsOptions {
  activateWalletId: string
  // If null, activate parent wallet:
  activateTokenIds: EdgeTokenId[]
}

export interface EdgeGetActivationAssetsResults {
  assetOptions: Array<{
    paymentWalletId?: string // If walletId is present, use MUST activate with this wallet
    currencyPluginId: string
    tokenId: EdgeTokenId
  }>
}

export interface EdgeActivationOptions {
  activateWalletId: string
  // If null, activate parent wallet:
  activateTokenIds: EdgeTokenId[]

  // Wallet if the user is paying with a different currency:
  paymentInfo?: {
    walletId: string
    tokenId: EdgeTokenId
  }
}

export interface EdgeActivationApproveOptions {
  metadata?: EdgeMetadata
}

export interface EdgeActivationResult {
  readonly transactions: EdgeTransaction[]
}

export interface EdgeActivationQuote {
  readonly paymentWalletId: string
  readonly paymentTokenId: EdgeTokenId

  readonly fromNativeAmount: string
  readonly networkFee: EdgeTxAmount & {
    /** @deprecated use contextual APIs to get the currency's pluginId */
    readonly currencyPluginId: string
  }

  readonly approve: (
    opts?: EdgeActivationApproveOptions
  ) => Promise<EdgeActivationResult>
  close: () => Promise<void>
}

export interface EdgeCurrencyWallet {
  readonly on: Subscriber<EdgeCurrencyWalletEvents>
  readonly watch: Subscriber<EdgeCurrencyWallet>

  // Data store:
  readonly created: Date | undefined
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

  // Chain state:
  readonly balanceMap: EdgeBalanceMap
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

  /* Tokens detected on chain */
  readonly detectedTokenIds: string[]

  // Transaction history:
  readonly getNumTransactions: (opts: EdgeTokenIdOptions) => Promise<number>
  readonly getTransactions: (
    opts: EdgeGetTransactionsOptions
  ) => Promise<EdgeTransaction[]>
  readonly streamTransactions: (
    opts: EdgeStreamTransactionOptions
  ) => AsyncIterableIterator<EdgeTransaction[]>

  // Addresses:
  readonly getReceiveAddress: (
    opts: EdgeGetReceiveAddressOptions
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
  readonly saveTxAction: (opts: EdgeSaveTxActionOptions) => Promise<void>
  readonly saveTxMetadata: (opts: EdgeSaveTxMetadataOptions) => Promise<void>
  readonly signTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>
  readonly sweepPrivateKeys: (
    edgeSpendInfo: EdgeSpendInfo
  ) => Promise<EdgeTransaction>

  // Signing:
  readonly signBytes: (
    buf: Uint8Array,
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

  /** @deprecated Use `signBytes` instead. */
  readonly signMessage: (
    message: string,
    opts?: EdgeSignMessageOptions
  ) => Promise<string>
}

export interface EdgeMemoryWallet {
  readonly watch: Subscriber<EdgeMemoryWallet>
  readonly balanceMap: EdgeBalanceMap
  readonly detectedTokenIds: string[]
  readonly syncRatio: number
  readonly changeEnabledTokenIds: (tokenIds: string[]) => Promise<void>
  readonly startEngine: () => Promise<void>
  readonly getMaxSpendable: (spendInfo: EdgeSpendInfo) => Promise<string>
  readonly makeSpend: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>
  readonly signTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>
  readonly broadcastTx: (tx: EdgeTransaction) => Promise<EdgeTransaction>
  readonly saveTx: (tx: EdgeTransaction) => Promise<void>
  readonly close: () => Promise<void>
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

  /** @deprecated Use orderUri in EdgeTxAction */
  readonly orderUri?: string // The orderId would be appended to this
  readonly supportEmail: string
}

export interface EdgeSwapRequest {
  // Where?
  fromWallet: EdgeCurrencyWallet
  toWallet: EdgeCurrencyWallet

  // What?
  fromTokenId: EdgeTokenId
  toTokenId: EdgeTokenId

  // How much?
  nativeAmount: string
  quoteFor: 'from' | 'max' | 'to'
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
  savedAction?: EdgeTxAction
}

/**
 * If a provider can satisfy a request, what is their price?
 */
export interface EdgeSwapQuote {
  readonly swapInfo: EdgeSwapInfo
  readonly request: EdgeSwapRequest

  readonly isEstimate: boolean

  /**
   * This quote may be partially fulfilled with remaining source funds left
   * in wallet
   */
  readonly canBePartial?: boolean

  /**
   * Maximum amount of time this quote will take to be fulfilled (in seconds)
   */
  readonly maxFulfillmentSeconds?: number

  /** Worst-case receive amount */
  readonly minReceiveAmount?: string

  readonly fromNativeAmount: string
  readonly toNativeAmount: string
  readonly networkFee: EdgeTxAmount & {
    /** @deprecated use tokenId */
    currencyCode: string
  }

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
    opts: { infoPayload: JsonObject; promoCode?: string }
  ) => Promise<EdgeSwapQuote>
}

// ---------------------------------------------------------------------
// account
// ---------------------------------------------------------------------

export interface EdgeAccountOptions {
  /**
   * If the login server returns a ChallengeError,
   * the user needs to visit the challenge URL and answer the question.
   * If the user succeeds, the challengeId will allow them to log in:
   */
  challengeId?: string

  /**
   * The current time, if different from `new Date()`.
   * Useful for unit testing.
   */
  now?: Date

  /** The user's OTP secret. */
  otpKey?: string

  /** A 6-digit OTP derived from the OTP secret. */
  otp?: string

  /** True to start wallets in the paused state. */
  pauseWallets?: boolean
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

// credentials ---------------------------------------------------------

export interface ChangePinOptions {
  /** Keeps the existing PIN if unspecified */
  pin?: string

  /** Defaults to true if unspecified */
  enableLogin?: boolean
}

export interface ChangeUsernameOptions {
  username: string

  /**
   * Changing the username requires passing the password, if present.
   * If the account has no password, providing this will create one.
   */
  password?: string
}

// currencies ----------------------------------------------------------

export interface EdgeCreateCurrencyWalletOptions {
  enabledTokenIds?: string[]
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

export type EdgeCreateCurrencyWallet = EdgeCreateCurrencyWalletOptions & {
  walletType: string
}

export interface EdgeCurrencyConfig {
  readonly watch: Subscriber<EdgeCurrencyConfig>

  readonly currencyInfo: EdgeCurrencyInfo

  // Tokens:
  readonly allTokens: EdgeTokenMap
  readonly builtinTokens: EdgeTokenMap
  readonly customTokens: EdgeTokenMap
  readonly getTokenId: (token: EdgeToken) => Promise<string>
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

  /**
   * If we have some quotes already, how long should we wait
   * for stragglers before we give up? Defaults to 20000ms.
   */
  slowResponseMs?: number

  /**
   * If don't have any quotes yet, how long should we wait
   * before we give up? Defaults to Infinity.
   */
  noResponseMs?: number
}

// edge login ----------------------------------------------------------

export interface EdgeLoginRequest {
  readonly appId: string

  readonly displayName: string
  readonly displayImageDarkUrl?: string
  readonly displayImageLightUrl?: string

  readonly approve: () => Promise<void>
  readonly close: () => Promise<void>
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
  readonly recoveryKey: string | undefined // base58, for email backup
  readonly rootLoginId: string // base58
  readonly username: string | undefined

  /** Gets the base58 decryption key for biometric login */
  readonly getLoginKey: () => Promise<string> // base58

  // Special-purpose API's:
  readonly currencyConfig: EdgePluginMap<EdgeCurrencyConfig>
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
  readonly changePin: (opts: ChangePinOptions) => Promise<string>
  readonly changeRecovery: (
    questions: string[],
    answers: string[]
  ) => Promise<string>
  readonly changeUsername: (opts: ChangeUsernameOptions) => Promise<void>

  // Verify existing credentials:
  readonly checkPassword: (password: string) => Promise<boolean>
  readonly checkPin: (pin: string) => Promise<boolean>
  readonly getPin: () => Promise<string | undefined>

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
  readonly getFirstWalletInfo: (type: string) => EdgeWalletInfoFull | undefined
  readonly getWalletInfo: (id: string) => EdgeWalletInfoFull | undefined
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
    walletType: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ) => Promise<EdgeCurrencyWallet>
  readonly createCurrencyWallets: (
    createWallets: EdgeCreateCurrencyWallet[]
  ) => Promise<Array<EdgeResult<EdgeCurrencyWallet>>>
  readonly waitForCurrencyWallet: (
    walletId: string
  ) => Promise<EdgeCurrencyWallet>
  readonly waitForAllWallets: () => Promise<void>
  readonly makeMemoryWallet: (
    walletType: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ) => Promise<EdgeMemoryWallet>

  // Token & wallet activation:
  readonly getActivationAssets: (
    options: EdgeGetActivationAssetsOptions
  ) => Promise<EdgeGetActivationAssetsResults>
  readonly activateWallet: (
    options: EdgeActivationOptions
  ) => Promise<EdgeActivationQuote>

  // Swapping:
  readonly fetchSwapQuote: (
    request: EdgeSwapRequest,
    opts?: EdgeSwapRequestOptions
  ) => Promise<EdgeSwapQuote>
  readonly fetchSwapQuotes: (
    request: EdgeSwapRequest,
    opts?: EdgeSwapRequestOptions
  ) => Promise<EdgeSwapQuote[]>
}

// ---------------------------------------------------------------------
// context types
// ---------------------------------------------------------------------

export type EdgeCorePlugin = EdgeCurrencyPlugin | EdgeSwapPlugin

export type EdgeCorePluginFactory = (
  env: EdgeCorePluginOptions
) => EdgeCorePlugin

export type EdgeCorePlugins = EdgePluginMap<
  EdgeCorePlugin | EdgeCorePluginFactory
>

export type EdgeCorePluginsInit = EdgePluginMap<boolean | JsonObject>

export interface EdgeContextOptions {
  apiKey?: string
  apiSecret?: Uint8Array
  appId: string
  authServer?: string
  infoServer?: string | string[]
  syncServer?: string | string[]
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

  /** True to load Airbitz user files from disk */
  airbitzSupport?: boolean

  /**
   * True to skip updating the `EdgeCurrencyWallet.blockHeight` property.
   * This may improve performance by reducing bridge traffic,
   * but there will be no way to query the overall chain height.
   * The core will continue updating individual transactions
   * as their confirmation status changes.
   */
  skipBlockHeight?: boolean
}

// parameters ----------------------------------------------------------

export interface EdgeCreateAccountOptions {
  username?: string
  password?: string
  pin?: string
}

export interface EdgeLoginMessage {
  loginId: string // base64
  otpResetPending: boolean
  pendingVouchers: EdgePendingVoucher[]
  recovery2Corrupt: boolean
  username?: string
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
  username?: string
  voucherId?: string
}

// context -------------------------------------------------------------

export interface EdgeContextEvents {
  close: void
  error: any // Will change to `unknown`
}

export interface EdgeContext {
  readonly on: Subscriber<EdgeContextEvents>
  readonly watch: Subscriber<EdgeContext>
  readonly close: () => Promise<void>

  readonly appId: string
  readonly clientId: string // Unique base58 ID for each app installation

  // Local user management:
  localUsers: EdgeUserInfo[]
  readonly forgetAccount: (rootLoginId: string) => Promise<void>

  // Account creation:
  /** Preemptively requests a CAPTCHA for account creation. */
  readonly fetchChallenge: () => Promise<{
    challengeId: string
    /** If this is missing, the challenge is already solved. */
    challengeUri?: string
  }>
  readonly fixUsername: (username: string) => string
  readonly usernameAvailable: (
    username: string,
    opts?: { challengeId?: string }
  ) => Promise<boolean>
  readonly createAccount: (
    opts: EdgeCreateAccountOptions & EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // Barcode login:
  readonly requestEdgeLogin: (
    opts?: EdgeAccountOptions
  ) => Promise<EdgePendingEdgeLogin>

  // Fingerprint login:
  readonly loginWithKey: (
    usernameOrLoginId: string,
    loginKey: string,
    opts?: EdgeAccountOptions & { useLoginId?: boolean }
  ) => Promise<EdgeAccount>

  // Password login:
  readonly checkPasswordRules: (password: string) => EdgePasswordRules
  readonly loginWithPassword: (
    username: string,
    password: string,
    opts?: EdgeAccountOptions
  ) => Promise<EdgeAccount>

  // PIN login:
  readonly loginWithPIN: (
    usernameOrLoginId: string,
    pin: string,
    opts?: EdgeAccountOptions & { useLoginId?: boolean }
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

  // OTP stuff:
  readonly requestOtpReset: (
    username: string,
    otpResetToken: string
  ) => Promise<Date>
  readonly fetchLoginMessages: () => Promise<EdgeLoginMessage[]>

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
  airbitzSupport?: boolean
  apiKey?: string
  apiSecret?: Uint8Array
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

  /** Extra files to be saved on the fake device. */
  extraFiles?: { [path: string]: string }
}

/**
 * A block of JSON data that can be used to save & restore a user
 * on the fake unit-testing server.
 */
export interface EdgeFakeUser {
  username?: string
  lastLogin?: Date
  loginId: string // base64
  loginKey: string // base64
  repos: {
    [syncKey: string]: unknown // Cleaned with asEdgeRepoDump
  }
  server: unknown // Cleaned with asEdgeLoginDump
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

/** @deprecated use EdgeTxAmount instead */
export interface EdgeNetworkFee {
  readonly currencyCode: string
  readonly nativeAmount: string
}

/** @deprecated use EdgeTxAmount instead */
export interface EdgeNetworkFee2 {
  readonly nativeAmount: string
  readonly currencyPluginId: string
  readonly tokenId: EdgeTokenId
}

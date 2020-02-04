// @flow

import { type Disklet } from 'disklet'
import { type Subscriber } from 'yaob'

export {
  DustSpendError,
  errorNames,
  InsufficientFundsError,
  SpendToSelfError,
  NetworkError,
  NoAmountSpecifiedError,
  ObsoleteApiError,
  OtpError,
  PasswordError,
  PendingFundsError,
  SameCurrencyError,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError,
  UsernameError
} from './error.js'

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
  [pluginName: string]: Value
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

/**
 * The subset of the `fetch` options we guarantee to support.
 */
export type EdgeFetchOptions = {
  method?: string,
  body?: ArrayBuffer | string,
  headers?: { [header: string]: string }
}

/**
 * The subset of the `Headers` DOM object we guarantee to support.
 */
export type EdgeFetchHeaders = {
  forEach(
    callback: (value: string, name: string, self: EdgeFetchHeaders) => void,
    thisArg?: any
  ): void,
  get(name: string): string | null,
  has(name: string): boolean
}

/**
 * The subset of the `Response` DOM object we guarantee to support.
 */
export type EdgeFetchResponse = {
  +headers: EdgeFetchHeaders,
  +ok: boolean,
  +status: number,
  arrayBuffer(): Promise<ArrayBuffer>,
  json(): Promise<any>,
  text(): Promise<string>
}

/**
 * The subset of the `fetch` DOM function we guarantee to support,
 * especially if we have to emulate `fetch` in weird environments.
 */
export type EdgeFetchFunction = (
  uri: string,
  opts?: EdgeFetchOptions
) => Promise<EdgeFetchResponse>

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
  +fetchCors?: EdgeFetchFunction,

  // Deprecated:
  // eslint-disable-next-line no-use-before-define
  +console: EdgeConsole,
  +WebSocket: typeof WebSocket
}

// logging -------------------------------------------------------------

export type EdgeLogMethod = (...args: any[]) => void

/**
 * Logs a message. Call `log(message)` for normal information messages,
 * or `log.warn(message)` / `log.error(message)` for something more severe.
 */
export type EdgeLog = EdgeLogMethod & {
  +warn: EdgeLogMethod,
  +error: EdgeLogMethod
}

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

// currency info -------------------------------------------------------

export type EdgeDenomination = {
  name: string,
  multiplier: string,
  symbol?: string
}

export type EdgeMetaToken = {
  currencyCode: string,
  currencyName: string,
  denominations: EdgeDenomination[],
  contractAddress?: string,
  symbolImage?: string
}

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
  displayName: string,
  pluginName: string,
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
  name?: string,
  category?: string,
  notes?: string,
  amountFiat?: number,
  bizId?: number,
  miscJson?: string
}

export type EdgeNetworkFee = {
  +currencyCode: string,
  +nativeAmount: string
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

  // Core:
  metadata?: EdgeMetadata,
  wallet?: EdgeCurrencyWallet, // eslint-disable-line no-use-before-define
  otherParams?: JsonObject
}

export type EdgeSpendTarget = {
  nativeAmount?: string,
  publicAddress?: string,
  otherParams?: JsonObject
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
  networkFeeOption?: string, // 'high' | 'standard' | 'low' | 'custom',
  customNetworkFee?: JsonObject, // Some kind of currency-specific JSON

  // Core:
  metadata?: EdgeMetadata,
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

export type EdgeTokenInfo = {
  currencyCode: string,
  currencyName: string,
  contractAddress: string,
  multiplier: string
}

export type EdgeTxidMap = { [txid: string]: number }

// URI -----------------------------------------------------------------

export type EdgeParsedUri = {
  token?: EdgeMetaToken,
  privateKeys?: string[],
  publicAddress?: string,
  legacyAddress?: string,
  segwitAddress?: string,
  nativeAmount?: string,
  currencyCode?: string,
  metadata?: EdgeMetadata,
  bitIDURI?: string,
  bitIDDomain?: string,
  bitIDCallbackUri?: string,
  paymentProtocolUrl?: string,
  returnUri?: string,
  uniqueIdentifier?: string, // Ripple payment id
  bitidPaymentAddress?: string, // Experimental
  bitidKycProvider?: string, // Experimental
  bitidKycRequest?: string // Experimental
}

export type EdgeEncodeUri = {
  publicAddress: string,
  segwitAddress?: string,
  legacyAddress?: string,
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
  startDate?: number,
  endDate?: number,
  searchString?: string,
  returnIndex?: number,
  returnEntries?: number,
  denomination?: string
}

// engine --------------------------------------------------------------

export type EdgeCurrencyEngineCallbacks = {
  +onBlockHeightChanged: (blockHeight: number) => void,
  +onTransactionsChanged: (transactions: EdgeTransaction[]) => void,
  +onBalanceChanged: (currencyCode: string, nativeBalance: string) => void,
  +onAddressesChecked: (progressRatio: number) => void,
  +onTxidsChanged: (txids: EdgeTxidMap) => void
}

export type EdgeCurrencyEngineOptions = {
  callbacks: EdgeCurrencyEngineCallbacks,
  log: EdgeLog, // Wallet-scoped logging
  walletLocalDisklet: Disklet,
  walletLocalEncryptedDisklet: Disklet,
  userSettings: JsonObject | void
}

export type EdgeCurrencyEngine = {
  changeUserSettings(settings: JsonObject): Promise<mixed>,

  // Keys:
  getDisplayPrivateSeed(): string | null,
  getDisplayPublicSeed(): string | null,

  // Engine status:
  startEngine(): Promise<mixed>,
  killEngine(): Promise<mixed>,
  resyncBlockchain(): Promise<mixed>,
  dumpData(): EdgeDataDump,

  // Chain state:
  getBlockHeight(): number,
  getBalance(opts: EdgeCurrencyCodeOptions): string,
  getNumTransactions(opts: EdgeCurrencyCodeOptions): number,
  getTransactions(opts: EdgeGetTransactionsOptions): Promise<EdgeTransaction[]>,
  getTxids?: () => EdgeTxidMap,

  // Tokens:
  enableTokens(tokens: string[]): Promise<mixed>,
  disableTokens(tokens: string[]): Promise<mixed>,
  getEnabledTokens(): Promise<string[]>,
  addCustomToken(token: EdgeTokenInfo): Promise<mixed>,
  getTokenStatus(token: string): boolean,

  // Addresses:
  getFreshAddress(opts: EdgeCurrencyCodeOptions): EdgeFreshAddress,
  addGapLimitAddresses(addresses: string[]): void,
  isAddressUsed(address: string): boolean,

  // Spending:
  makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  signTx(transaction: EdgeTransaction): Promise<EdgeTransaction>,
  broadcastTx(transaction: EdgeTransaction): Promise<EdgeTransaction>,
  saveTx(transaction: EdgeTransaction): Promise<mixed>,
  +sweepPrivateKeys?: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  +getPaymentProtocolInfo?: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>,

  // Escape hatch:
  +otherMethods?: EdgeOtherMethods
}

// currency plugin -----------------------------------------------------

export type EdgeCurrencyTools = {
  // Keys:
  +importPrivateKey?: (key: string, opts?: JsonObject) => Promise<JsonObject>,
  createPrivateKey(walletType: string, opts?: JsonObject): Promise<JsonObject>,
  derivePublicKey(walletInfo: EdgeWalletInfo): Promise<JsonObject>,
  +getSplittableTypes?: (walletInfo: EdgeWalletInfo) => string[],

  // URIs:
  parseUri(
    uri: string,
    currencyCode?: string,
    customTokens?: EdgeMetaToken[]
  ): Promise<EdgeParsedUri>,
  encodeUri(obj: EdgeEncodeUri, customTokens?: EdgeMetaToken[]): Promise<string>
}

export type EdgeCurrencyPlugin = {
  +currencyInfo: EdgeCurrencyInfo,

  makeCurrencyTools(): Promise<EdgeCurrencyTools>,
  makeCurrencyEngine(
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine>,

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
  transactionsChanged: EdgeTransaction[]
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
  sync(): Promise<mixed>,

  // Wallet keys:
  +displayPrivateSeed: string | null,
  +displayPublicSeed: string | null,

  // Wallet name:
  +name: string | null,
  renameWallet(name: string): Promise<mixed>,

  // Fiat currency option:
  +fiatCurrencyCode: string,
  setFiatCurrencyCode(fiatCurrencyCode: string): Promise<mixed>,

  // Currency info:
  +currencyInfo: EdgeCurrencyInfo,
  nativeToDenomination(
    nativeAmount: string,
    currencyCode: string
  ): Promise<string>,
  denominationToNative(
    denominatedAmount: string,
    currencyCode: string
  ): Promise<string>,

  // Chain state:
  +balances: EdgeBalances,
  +blockHeight: number,
  +syncRatio: number,

  // Running state:
  startEngine(): Promise<mixed>,
  stopEngine(): Promise<mixed>,

  // Token management:
  changeEnabledTokens(currencyCodes: string[]): Promise<mixed>,
  enableTokens(tokens: string[]): Promise<mixed>,
  disableTokens(tokens: string[]): Promise<mixed>,
  getEnabledTokens(): Promise<string[]>,
  addCustomToken(token: EdgeTokenInfo): Promise<mixed>,

  // Transaction history:
  getNumTransactions(opts?: EdgeCurrencyCodeOptions): Promise<number>,
  getTransactions(
    opts?: EdgeGetTransactionsOptions
  ): Promise<EdgeTransaction[]>,

  // Addresses:
  getReceiveAddress(
    opts?: EdgeCurrencyCodeOptions
  ): Promise<EdgeReceiveAddress>,
  saveReceiveAddress(receiveAddress: EdgeReceiveAddress): Promise<mixed>,
  lockReceiveAddress(receiveAddress: EdgeReceiveAddress): Promise<mixed>,

  // Sending:
  makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  signTx(tx: EdgeTransaction): Promise<EdgeTransaction>,
  broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction>,
  saveTx(tx: EdgeTransaction): Promise<mixed>,
  sweepPrivateKeys(edgeSpendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  saveTxMetadata(
    txid: string,
    currencyCode: string,
    metadata: EdgeMetadata
  ): Promise<mixed>,
  getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string>,
  getPaymentProtocolInfo(
    paymentProtocolUrl: string
  ): Promise<EdgePaymentProtocolInfo>,

  // Wallet management:
  resyncBlockchain(): Promise<mixed>,
  dumpData(): Promise<EdgeDataDump>,
  getDisplayPrivateSeed(): string | null,
  getDisplayPublicSeed(): string | null,

  // Data exports:
  exportTransactionsToQBO(opts: EdgeGetTransactionsOptions): Promise<string>,
  exportTransactionsToCSV(opts: EdgeGetTransactionsOptions): Promise<string>,

  // URI handling:
  parseUri(uri: string, currencyCode?: string): Promise<EdgeParsedUri>,
  encodeUri(obj: EdgeEncodeUri): Promise<string>,

  +otherMethods: EdgeOtherMethods,

  // Deprecated API's:
  getBalance(opts?: EdgeCurrencyCodeOptions): string,
  getBlockHeight(): number
}

// ---------------------------------------------------------------------
// swap plugin
// ---------------------------------------------------------------------

export type EdgeSwapInfo = {
  +displayName: string,
  +pluginName: string,

  +quoteUri?: string, // The quoteId would be appended to this
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
  quoteFor: 'from' | 'to'
}

export type EdgeSwapPluginQuote = {
  +isEstimate?: boolean, // Defaults to true. Edge prefers true quotes (not estimates) where possible.
  +fromNativeAmount: string,
  +toNativeAmount: string,
  +networkFee: EdgeNetworkFee,
  +destinationAddress: string,

  +pluginName: string,
  +expirationDate?: Date,
  +quoteId?: string,

  approve(): Promise<EdgeTransaction>,
  close(): Promise<mixed>
}

export type EdgeSwapPluginStatus = {
  needsActivation?: boolean
}

export type EdgeSwapPlugin = {
  +swapInfo: EdgeSwapInfo,

  checkSettings?: (userSettings: JsonObject) => EdgeSwapPluginStatus,
  fetchSwapQuote(
    request: EdgeSwapRequest,
    userSettings: JsonObject | void
  ): Promise<EdgeSwapPluginQuote>
}

// ---------------------------------------------------------------------
// rate plugin
// ---------------------------------------------------------------------

export type EdgeRateHint = {
  fromCurrency: string,
  toCurrency: string
}

export type EdgeRateInfo = {
  +displayName: string
}

export type EdgeRatePair = {
  fromCurrency: string,
  toCurrency: string,
  rate: number
}

export type EdgeRatePlugin = {
  +rateInfo: EdgeRateInfo,

  fetchRates(hints: EdgeRateHint[]): Promise<EdgeRatePair[]>
}

// ---------------------------------------------------------------------
// account
// ---------------------------------------------------------------------

export type EdgeAccountOptions = {
  otp?: string
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
  +otherMethods: EdgeOtherMethods,
  +userSettings: JsonObject | void,

  changeUserSettings(settings: JsonObject): Promise<mixed>,
  importKey(userInput: string): Promise<JsonObject>
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

export type EdgeRateCache = {
  +on: Subscriber<EdgeRateCacheEvents>,

  convertCurrency(
    fromCurrency: string,
    toCurrency: string,
    amount: number
  ): Promise<number>
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

  changeEnabled(enabled: boolean): Promise<mixed>,
  changeUserSettings(settings: JsonObject): Promise<mixed>
}

export type EdgeSwapQuote = EdgeSwapPluginQuote & {
  +isEstimate: boolean, // No longer optional at this point
  +quoteUri?: string
}

// edge login ----------------------------------------------------------

export type EdgeLoginRequest = {
  +appId: string,
  approve(): Promise<mixed>,

  +displayName: string,
  +displayImageUrl: string | void
}

export type EdgeLobby = {
  +loginRequest: EdgeLoginRequest | void
  // walletRequest: EdgeWalletRequest | void
}

// storage -------------------------------------------------------------

export type EdgeDataStore = {
  deleteItem(storeId: string, itemId: string): Promise<mixed>,
  deleteStore(storeId: string): Promise<mixed>,

  listItemIds(storeId: string): Promise<string[]>,
  listStoreIds(): Promise<string[]>,

  getItem(storeId: string, itemId: string): Promise<string>,
  setItem(storeId: string, itemId: string, value: string): Promise<mixed>
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
  sync(): Promise<mixed>,

  // Basic login information:
  +appId: string,
  +loggedIn: boolean,
  +loginKey: string,
  +recoveryKey: string | void, // For email backup
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
  changePassword(password: string): Promise<mixed>,
  changePin(opts: {
    pin?: string, // We keep the existing PIN if unspecified
    enableLogin?: boolean // We default to true if unspecified
  }): Promise<string>,
  changeRecovery(questions: string[], answers: string[]): Promise<string>,

  // Verify existing credentials:
  checkPassword(password: string): Promise<boolean>,
  checkPin(pin: string): Promise<boolean>,

  // Remove credentials:
  deletePassword(): Promise<mixed>,
  deletePin(): Promise<mixed>,
  deleteRecovery(): Promise<mixed>,

  // OTP:
  +otpKey: string | void, // OTP is enabled if this exists
  +otpResetDate: string | void, // A reset is requested if this exists
  cancelOtpReset(): Promise<mixed>,
  disableOtp(): Promise<mixed>,
  enableOtp(timeout?: number): Promise<mixed>,

  // Edge login approval:
  fetchLobby(lobbyId: string): Promise<EdgeLobby>,

  // Login management:
  logout(): Promise<mixed>,

  // Master wallet list:
  +allKeys: EdgeWalletInfoFull[],
  changeWalletStates(walletStates: EdgeWalletStates): Promise<mixed>,
  createWallet(type: string, keys?: JsonObject): Promise<string>,
  getFirstWalletInfo(type: string): EdgeWalletInfo | void,
  getWalletInfo(id: string): EdgeWalletInfo | void,
  listWalletIds(): string[],
  listSplittableWalletTypes(walletId: string): Promise<string[]>,
  splitWalletInfo(walletId: string, newWalletType: string): Promise<string>,

  // Currency wallets:
  +activeWalletIds: string[],
  +archivedWalletIds: string[],
  +hiddenWalletIds: string[],
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet },
  createCurrencyWallet(
    type: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ): Promise<EdgeCurrencyWallet>,
  waitForCurrencyWallet(walletId: string): Promise<EdgeCurrencyWallet>,

  // Web compatibility:
  signEthereumTransaction(
    walletId: string,
    transaction: EthereumTransaction
  ): Promise<string>,
  signRequestTransaction(walletId: string, transaction: any): Promise<string>,

  // Swapping:
  fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote>,

  // Deprecated names:
  // eslint-disable-next-line no-use-before-define
  +pluginData: EdgePluginData,
  +exchangeCache: EdgeRateCache,
  +currencyTools: EdgePluginMap<EdgeCurrencyConfig>,
  +exchangeTools: EdgePluginMap<EdgeSwapConfig>,
  getExchangeQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote>
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
  path?: string, // Only used on node.js
  plugins?: EdgeCorePluginsInit
}

// parameters ----------------------------------------------------------

export type EdgeEdgeLoginOptions = EdgeAccountOptions & {
  // Deprecated. The info server handles these now:
  displayImageUrl?: string,
  displayName?: string
}

export type EdgeLoginMessages = {
  [username: string]: {
    otpResetPending: boolean,
    recovery2Corrupt: boolean
  }
}

export type EdgePasswordRules = {
  secondsToCrack: number,
  tooShort: boolean,
  noNumber: boolean,
  noLowerCase: boolean,
  noUpperCase: boolean,
  passed: boolean
}

export type EdgePendingEdgeLogin = {
  +id: string,
  cancelRequest(): void
}

export type EdgeUserInfo = {
  pinLoginEnabled: boolean,
  recovery2Key?: string,
  username: string
}

// context -------------------------------------------------------------

export type EdgeContextEvents = {
  close: void,
  error: Error,
  login: EdgeAccount,
  loginStart: { username: string },
  loginError: { error: Error }
}

export type EdgeContext = {
  +on: Subscriber<EdgeContextEvents>,
  +watch: Subscriber<EdgeContext>,
  close(): Promise<mixed>,

  +appId: string,

  // Local user management:
  localUsers: EdgeUserInfo[],
  fixUsername(username: string): string,
  listUsernames(): Promise<string[]>,
  deleteLocalAccount(username: string): Promise<mixed>,

  // Account creation:
  usernameAvailable(username: string): Promise<boolean>,
  createAccount(
    username: string,
    password?: string,
    pin?: string,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,

  // Edge login:
  requestEdgeLogin(opts: EdgeEdgeLoginOptions): Promise<EdgePendingEdgeLogin>,

  // Fingerprint login:
  loginWithKey(
    username: string,
    loginKey: string,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,

  // Password login:
  checkPasswordRules(password: string): EdgePasswordRules,
  loginWithPassword(
    username: string,
    password: string,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,

  // PIN login:
  pinLoginEnabled(username: string): Promise<boolean>,
  loginWithPIN(
    username: string,
    pin: string,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,

  // Recovery2 login:
  getRecovery2Key(username: string): Promise<string>,
  loginWithRecovery2(
    recovery2Key: string,
    username: string,
    answers: string[],
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,
  fetchRecovery2Questions(
    recovery2Key: string,
    username: string
  ): Promise<string[]>,
  listRecoveryQuestionChoices(): Promise<string[]>,

  // OTP stuff:
  requestOtpReset(username: string, otpResetToken: string): Promise<Date>,
  fetchLoginMessages(): Promise<EdgeLoginMessages>,

  // Background mode:
  +paused: boolean,
  changePaused(
    paused: boolean,
    opts?: { secondsDelay?: number }
  ): Promise<mixed>
}

// ---------------------------------------------------------------------
// fake mode
// ---------------------------------------------------------------------

export type EdgeFakeUser = {
  username: string,
  loginId: string,
  loginKey: string,
  repos: { [repo: string]: { [path: string]: JsonObject } },
  server: JsonObject
}

export type EdgeFakeWorld = {
  close(): Promise<mixed>,

  makeEdgeContext(
    opts: EdgeContextOptions & { cleanDevice?: boolean }
  ): Promise<EdgeContext>,

  goOffline(offline?: boolean): Promise<mixed>,
  dumpFakeUser(account: EdgeAccount): Promise<EdgeFakeUser>
}

// ---------------------------------------------------------------------
// deprecated types
// ---------------------------------------------------------------------

// The only subset of `Console` that Edge core uses:
export type EdgeConsole = {
  error(...data: any[]): void,
  info(...data: any[]): void,
  warn(...data: any[]): void
}

export type EdgeBitcoinPrivateKeyOptions = {
  format?: string,
  coinType?: number,
  account?: number
}

export type EdgeCreatePrivateKeyOptions =
  | EdgeBitcoinPrivateKeyOptions
  | JsonObject

export type EdgePluginData = {
  deleteItem(pluginId: string, itemId: string): Promise<mixed>,
  deletePlugin(pluginId: string): Promise<mixed>,

  listItemIds(pluginId: string): Promise<string[]>,
  listPluginIds(): Promise<string[]>,

  getItem(pluginId: string, itemId: string): Promise<string>,
  setItem(pluginId: string, itemId: string, value: string): Promise<mixed>
}

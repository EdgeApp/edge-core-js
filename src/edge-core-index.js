// @flow

// Sub-module exports:
import * as error from './error.js'
import * as internal from './internal.js'

export { error }
export { internal }

// Ancillary exports:
export { makeBrowserIo } from './io/browser/browser-io.js'
export { makeFakeIos } from './io/fake/fake-io.js'
export { makeNodeIo } from './io/node/node-io.js'
export { makeReactNativeIo } from './io/react-native/react-native-io.js'
export { fakeUser } from './io/fake/fakeUser.js'
export {
  DustSpendError,
  errorNames,
  InsufficientFundsError,
  NetworkError,
  ObsoleteApiError,
  OtpError,
  PasswordError,
  PendingFundsError,
  SameCurrencyError,
  UsernameError
} from './error.js'
export {
  makeContext,
  makeEdgeContext,
  makeFakeContexts
} from './makeContext.js'
export { destroyAllContexts } from './modules/root.js'

// io types -----------------------------------------------------------

export interface DiskletFile {
  delete(): Promise<void>;
  getData(): Promise<Uint8Array>;
  getText(): Promise<string>;
  setData(data: Array<number> | Uint8Array): Promise<void>;
  setText(text: string): Promise<void>;
}

export interface DiskletFolder {
  delete(): Promise<void>;
  file(name: string): DiskletFile;
  folder(name: string): DiskletFolder;
  listFiles(): Promise<Array<string>>;
  listFolders(): Promise<Array<string>>;
}

// Node.js randomBytes function:
export type EdgeRandomFunction = (bytes: number) => Uint8Array

// The only subset of `Console` that Edge core uses:
export type EdgeConsole = {
  error(...data: Array<any>): void,
  info(...data: Array<any>): void,
  warn(...data: Array<any>): void
}

// The scrypt function Edge expects:
export type EdgeScryptFunction = (
  data: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  dklen: number
) => Promise<Uint8Array>

export type EdgeSecp256k1 = {
  publicKeyCreate: (
    privateKey: Uint8Array,
    compressed: boolean
  ) => Promise<string>,
  privateKeyTweakAdd: (
    privateKey: Uint8Array,
    tweak: Uint8Array
  ) => Promise<Uint8Array>,
  publicKeyTweakAdd: (
    publicKey: Uint8Array,
    tweak: Uint8Array,
    compressed: boolean
  ) => Promise<Uint8Array>
}

export type EdgePbkdf2 = {
  deriveAsync: (
    key: Uint8Array,
    salt: Uint8Array,
    iter: number,
    len: number,
    algo: string
  ) => Promise<Uint8Array>
}

/**
 * Access to platform-specific resources, with many optional fields.
 * The core will emulate/adapt whatever is missing.
 */
export type EdgeRawIo = {
  // Crypto:
  +random: EdgeRandomFunction, // Non-optional & security-critical
  +scrypt?: EdgeScryptFunction,
  +secp256k1?: EdgeSecp256k1,
  +pbkdf2?: EdgePbkdf2,

  // Local io:
  +console?: EdgeConsole,
  +folder?: DiskletFolder,
  +localStorage?: Storage,

  // Networking:
  +fetch: typeof fetch,
  +Socket?: net$Socket,
  +TLSSocket?: tls$TLSSocket,
  +WebSocket: WebSocket
}

/**
 * Access to platform-specific resources.
 * The core never talks to the outside world on its own,
 * but always goes through this object.
 */
export type EdgeIo = {
  // Crypto:
  +random: EdgeRandomFunction,
  +scrypt: EdgeScryptFunction,
  // TODO: Make these two non-optional, providing JS versions as needed:
  +secp256k1?: EdgeSecp256k1,
  +pbkdf2?: EdgePbkdf2,

  // Local io:
  +console: EdgeConsole,
  +folder: DiskletFolder,

  // Networking:
  +fetch: typeof fetch,
  +Socket?: net$Socket, // Still optional (no browser version)
  +TLSSocket?: tls$TLSSocket, // Still optional (no browser version)
  +WebSocket: WebSocket
}

// context types ------------------------------------------------------

/* eslint-disable no-use-before-define */
export type EdgeCorePluginFactory =
  | EdgeCurrencyPluginFactory
  | EdgeExchangePluginFactory

export type EdgeCorePluginOptions = {
  io: EdgeIo
}

export type EdgeContextCallbacks = {
  +onError?: (e: Error) => mixed,
  +onExchangeUpdate?: () => mixed
}

export type EdgeContextOptions = {
  apiKey?: string,
  appId?: string,
  authServer?: string,
  callbacks?: EdgeContextCallbacks,
  io?: EdgeRawIo,
  path?: string, // Only used on node.js
  plugins?: Array<EdgeCorePluginFactory>,
  shapeshiftKey?: string
}

export type EdgeContext = {
  appId: string,
  io: EdgeIo,

  // Local user management:
  fixUsername(username: string): string,
  listUsernames(): Promise<Array<string>>,
  deleteLocalAccount(username: string): Promise<void>,

  // Account creation:
  usernameAvailable(username: string): Promise<boolean>,
  createAccount(
    username: string,
    password?: string,
    pin?: string,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,

  // Edge login:
  requestEdgeLogin(opts: EdgeEdgeLoginOptions): Promise<EdgeEdgeLoginRequest>,

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
    pin: string,
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
    answers: Array<string>,
    opts?: EdgeAccountOptions
  ): Promise<EdgeAccount>,
  fetchRecovery2Questions(
    recovery2Key: string,
    username: string
  ): Promise<Array<string>>,
  listRecoveryQuestionChoices(): Promise<Array<string>>,

  // OTP stuff:
  requestOtpReset(username: string, otpResetToken: string): Promise<Date>,
  fetchLoginMessages(): Promise<EdgeLoginMessages>,

  // Misc. stuff:
  getCurrencyPlugins(): Promise<Array<EdgeCurrencyPlugin>>,

  // Shapeshift:
  getExchangeSwapRate(
    fromCurrencyCode: string,
    toCurrencyCode: string
  ): Promise<number>,
  getExchangeSwapInfo(
    fromCurrencyCode: string,
    toCurrencyCode: string
  ): Promise<EdgeExchangeSwapInfo>,
  getAvailableExchangeTokens(): Promise<Array<string>>
}

export type EdgeExchangeSwapInfo = {
  rate: number,
  nativeMin: string,
  nativeMax: string,
  minerFee: string
}

export type EdgePasswordRules = {
  secondsToCrack: number,
  tooShort: boolean,
  noNumber: boolean,
  noLowerCase: boolean,
  noUpperCase: boolean,
  passed: boolean
}

export type EdgeEdgeLoginRequest = {
  id: string,
  cancelRequest(): void
}

export type EdgeEdgeLoginOptions = EdgeAccountOptions & {
  displayImageUrl?: string,
  displayName?: string,
  onProcessLogin?: (username: string) => mixed,
  onLogin(e?: Error, account?: EdgeAccount): mixed
}

export type EdgeLoginMessages = {
  [username: string]: {
    otpResetPending: boolean,
    recovery2Corrupt: boolean
  }
}

// account types ------------------------------------------------------

export type EdgeWalletInfo = {
  id: string,
  type: string,
  keys: any
}

export type EdgeWalletInfoFull = {
  appIds: Array<string>,
  archived: boolean,
  deleted: boolean,
  id: string,
  keys: any,
  sortIndex: number,
  type: string
}

export type EdgeWalletState = {
  archived?: boolean,
  deleted?: boolean,
  sortIndex?: number
}

export type EdgeWalletStates = {
  [walletId: string]: EdgeWalletState
}

export type EdgeAccountCallbacks = {
  +onDataChanged?: () => mixed,
  +onKeyListChanged?: () => mixed,
  +onLoggedOut?: () => mixed,
  +onOtpDrift?: (drift: number) => mixed,
  +onRemoteOtpChange?: () => mixed,
  +onRemotePasswordChange?: () => mixed,

  // Currency wallet callbacks:
  +onAddressesChecked?: (walletId: string, progressRatio: number) => mixed,
  +onBalanceChanged?: (
    walletId: string,
    currencyCode: string,
    nativeBalance: string
  ) => mixed,
  +onBlockHeightChanged?: (walletId: string, blockHeight: number) => mixed,
  +onNewTransactions?: (
    walletId: string,
    abcTransactions: Array<EdgeTransaction>
  ) => mixed,
  +onTransactionsChanged?: (
    walletId: string,
    abcTransactions: Array<EdgeTransaction>
  ) => mixed,
  +onWalletDataChanged?: (walletId: string) => mixed,
  +onWalletNameChanged?: (walletId: string, name: string | null) => mixed
}

export type EdgeAccountOptions = {
  otp?: string,
  callbacks?: EdgeAccountCallbacks
}

export type EdgeCreateCurrencyWalletOptions = {
  name?: string,
  fiatCurrencyCode?: string,
  keys?: {}
}

export type EdgePluginData = {
  deleteItem(pluginId: string, itemId: string): Promise<mixed>,
  deletePlugin(pluginId: string): Promise<mixed>,

  listItemIds(pluginId: string): Promise<Array<string>>,
  listPluginIds(): Promise<Array<string>>,

  getItem(pluginId: string, itemId: string): Promise<string>,
  setItem(pluginId: string, itemId: string, value: string): Promise<mixed>
}

export type EdgeAccount = {
  // Basic login information:
  +appId: string,
  +loggedIn: boolean,
  +loginKey: string,
  +recoveryKey: string | void, // For email backup
  +username: string,

  // Special-purpose API's:
  +exchangeCache: any,
  +pluginData: EdgePluginData,

  // What login method was used?
  +edgeLogin: boolean,
  keyLogin: boolean,
  newAccount: boolean,
  passwordLogin: boolean,
  pinLogin: boolean,
  recoveryLogin: boolean,

  // Change or create credentials:
  changePassword(password: string): Promise<void>,
  changePin(opts: {
    pin?: string, // We keep the existing PIN if unspecified
    enableLogin?: boolean // We default to true if unspecified
  }): Promise<string>,
  changeRecovery(
    questions: Array<string>,
    answers: Array<string>
  ): Promise<string>,

  // Verify existing credentials:
  checkPassword(password: string): Promise<boolean>,
  checkPin(pin: string): Promise<boolean>,

  // Remove credentials:
  deletePassword(): Promise<void>,
  deletePin(): Promise<void>,
  deleteRecovery(): Promise<void>,

  // OTP:
  +otpKey: string | void, // OTP is enabled if this exists
  +otpResetDate: string | void, // A reset is requested if this exists
  cancelOtpReset(): Promise<void>,
  disableOtp(): Promise<void>,
  enableOtp(timeout?: number): Promise<void>,

  // Edge login approval:
  fetchLobby(lobbyId: string): Promise<EdgeLobby>,

  // Login management:
  logout(): Promise<void>,

  // Master wallet list:
  +allKeys: Array<EdgeWalletInfoFull>,
  changeWalletStates(walletStates: EdgeWalletStates): Promise<void>,
  createWallet(type: string, keys: any): Promise<string>,
  getFirstWalletInfo(type: string): ?EdgeWalletInfo,
  getWalletInfo(id: string): ?EdgeWalletInfo,
  listWalletIds(): Array<string>,
  listSplittableWalletTypes(walletId: string): Array<string>,
  splitWalletInfo(walletId: string, newWalletType: string): Promise<string>,

  // Currency wallets:
  +activeWalletIds: Array<string>,
  +archivedWalletIds: Array<string>,
  +currencyWallets: { [walletId: string]: EdgeCurrencyWallet },
  createCurrencyWallet(
    type: string,
    opts?: EdgeCreateCurrencyWalletOptions
  ): Promise<EdgeCurrencyWallet>
}

// edge login types ---------------------------------------------------

export type EdgeLobby = {
  loginRequest?: EdgeLoginRequest
  // walletRequest?: EdgeWalletRequest
}

export type EdgeLoginRequest = {
  appId: string,
  approve(): Promise<void>,

  displayName: string,
  displayImageUrl?: string
}

// currency wallet types ----------------------------------------------

export type EdgeTokenInfo = {
  currencyCode: string,
  currencyName: string,
  contractAddress: string,
  multiplier: string
}

export type EdgeGetTransactionsOptions = {
  currencyCode?: string,
  startIndex?: number,
  startEntries?: 100,
  startDate?: number,
  endDate?: number,
  searchString?: string,
  returnIndex?: number,
  returnEntries?: number,
  denomination?: string
}

export type EdgeCurrencyCodeOptions = {
  currencyCode?: string
}

export type EdgeTxidMap = { [txid: string]: number }

export type EdgeUnusedOptions = {}

export type EdgeCurrencyWallet = {
  // EdgeWalletInfo members:
  +id: string,
  +keys: any,
  +type: string,

  // Data store:
  +folder: DiskletFolder,
  +localFolder: DiskletFolder,
  sync(): Promise<void>,

  // Wallet name:
  +name: string | null,
  renameWallet(name: string): Promise<void>,

  // Fiat currency option:
  +fiatCurrencyCode: string,
  setFiatCurrencyCode(fiatCurrencyCode: string): Promise<void>,

  // Currency info:
  +currencyInfo: EdgeCurrencyInfo,

  // Running state:
  startEngine(): Promise<void>,
  stopEngine(): Promise<void>,

  // Token management:
  enableTokens(tokens: Array<string>): Promise<void>,
  disableTokens(tokens: Array<string>): Promise<void>,
  getEnabledTokens(): Promise<Array<string>>,
  addCustomToken(token: EdgeTokenInfo): Promise<void>,

  // Transactions:
  getBalance(opts?: EdgeCurrencyCodeOptions): string,
  getBlockHeight(): number,
  getNumTransactions(opts?: EdgeCurrencyCodeOptions): number,
  getTransactions(
    options?: EdgeGetTransactionsOptions
  ): Promise<Array<EdgeTransaction>>,
  getReceiveAddress(
    opts?: EdgeCurrencyCodeOptions
  ): Promise<EdgeReceiveAddress>,
  saveReceiveAddress(receiveAddress: EdgeReceiveAddress): Promise<void>,
  lockReceiveAddress(receiveAddress: EdgeReceiveAddress): Promise<void>,
  makeAddressQrCode(address: EdgeReceiveAddress): string,
  makeAddressUri(address: EdgeReceiveAddress): string,
  makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  signTx(tx: EdgeTransaction): Promise<EdgeTransaction>,
  broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction>,
  saveTx(tx: EdgeTransaction): Promise<void>,
  sweepPrivateKeys(edgeSpendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  saveTxMetadata(
    txid: string,
    currencyCode: string,
    metadata: EdgeMetadata
  ): Promise<void>,
  getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string>,
  getQuote(spendInfo: EdgeSpendInfo): Promise<EdgeCoinExchangeQuote>,
  getPaymentProtocolInfo?: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>,

  // Wallet management:
  resyncBlockchain(): Promise<void>,
  dumpData(): EdgeDataDump,
  getDisplayPrivateSeed(): string | null,
  getDisplayPublicSeed(): string | null,

  // Data exports:
  exportTransactionsToQBO(opts: EdgeGetTransactionsOptions): Promise<string>,
  exportTransactionsToCSV(opts: EdgeGetTransactionsOptions): Promise<string>,

  // URI handling:
  parseUri(uri: string): EdgeParsedUri,
  encodeUri(obj: EdgeEncodeUri): string
}

export type EdgeMetadata = {
  name?: string,
  category?: string,
  notes?: string,
  amountFiat?: number,
  bizId?: number,
  miscJson?: string
}

export type EdgeSpendTarget = {
  currencyCode?: string,
  destWallet?: EdgeCurrencyWallet,
  publicAddress?: string,
  nativeAmount?: string,
  destMetadata?: EdgeMetadata,
  otherParams?: Object
}

export type EdgeSpendInfo = {
  currencyCode?: string,
  noUnconfirmed?: boolean,
  privateKeys?: Array<string>,
  spendTargets: Array<EdgeSpendTarget>,
  nativeAmount?: string,
  quoteFor?: string,
  networkFeeOption?: string,
  customNetworkFee?: any,
  metadata?: EdgeMetadata,
  otherParams?: Object
}

export type EdgePaymentProtocolInfo = {
  domain: string,
  memo: string,
  merchant: string,
  nativeAmount: string,
  spendTargets: Array<EdgeSpendTarget>
}

export type EdgeTransaction = {
  txid: string,
  date: number,
  currencyCode: string,
  blockHeight: number,
  nativeAmount: string,
  networkFee: string,
  ourReceiveAddresses: Array<string>,
  signedTx: string,
  parentNetworkFee?: string,
  metadata?: EdgeMetadata,
  otherParams: any,
  wallet?: EdgeCurrencyWallet
}

export type EdgeDenomination = {
  name: string,
  multiplier: string,
  symbol?: string
}

export type EdgeMetaToken = {
  currencyCode: string,
  currencyName: string,
  denominations: Array<EdgeDenomination>,
  contractAddress?: string,
  symbolImage?: string
}

export type EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: string,
  currencyName: string,
  pluginName: string,
  denominations: Array<EdgeDenomination>,
  walletTypes: Array<string>,
  requiredConfirmations?: number,

  // Configuration options:
  defaultSettings: any,
  metaTokens: Array<EdgeMetaToken>,

  // Explorers:
  addressExplorer: string,
  blockExplorer?: string,
  transactionExplorer: string,

  // Images:
  symbolImage?: string,
  symbolImageDarkMono?: string
}

export type EdgeParsedUri = {
  token?: EdgeTokenInfo,
  privateKeys?: Array<string>,
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
  message?: string
}

export type EdgeFreshAddress = {
  publicAddress: string,
  segwitAddress?: string,
  legacyAddress?: string
}

export type EdgeDataDump = {
  walletId: string,
  walletType: string,
  pluginType: string,
  data: {
    [dataCache: string]: any
  }
}

export type EdgeReceiveAddress = EdgeFreshAddress & {
  metadata: EdgeMetadata,
  nativeAmount: string
}

export type EdgeCoinExchangeQuote = {
  depositAmountNative: string,
  withdrawalAmountNative: string,
  expiration: number, // this is in milliseconds since 1970/ it is a date.
  quotedRate: string,
  maxLimit: number,
  orderId: string,
  edgeTransacton: EdgeTransaction
}

// currency plugin types ----------------------------------------------

export type EdgeCurrencyEngineCallbacks = {
  +onBlockHeightChanged: (blockHeight: number) => void,
  +onTransactionsChanged: (abcTransactions: Array<EdgeTransaction>) => void,
  +onBalanceChanged: (currencyCode: string, nativeBalance: string) => void,
  +onAddressesChecked: (progressRatio: number) => void,
  +onTxidsChanged: (txids: EdgeTxidMap) => void
}

export type EdgeCurrencyEngineOptions = {
  callbacks: EdgeCurrencyEngineCallbacks,
  walletLocalFolder: DiskletFolder,
  walletLocalEncryptedFolder: DiskletFolder,
  optionalSettings?: any
}

export type EdgeCurrencyEngine = {
  updateSettings(settings: any): void,
  startEngine(): Promise<void>,
  killEngine(): Promise<void>,
  getBlockHeight(): number,
  enableTokens(tokens: Array<string>): Promise<void>,
  disableTokens(tokens: Array<string>): Promise<void>,
  getEnabledTokens(): Promise<Array<string>>,
  addCustomToken(token: EdgeTokenInfo): Promise<void>,
  getTokenStatus(token: string): boolean,
  getBalance(options: EdgeCurrencyCodeOptions): string,
  getNumTransactions(options: EdgeCurrencyCodeOptions): number,
  getTransactions(
    options: EdgeGetTransactionsOptions
  ): Promise<Array<EdgeTransaction>>,
  getFreshAddress(options: EdgeCurrencyCodeOptions): EdgeFreshAddress,
  addGapLimitAddresses(
    addresses: Array<string>,
    options: EdgeUnusedOptions
  ): void,
  isAddressUsed(address: string, options: EdgeUnusedOptions): boolean,
  makeSpend(abcSpendInfo: EdgeSpendInfo): Promise<EdgeTransaction>,
  +sweepPrivateKeys?: (abcSpendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>,
  signTx(abcTransaction: EdgeTransaction): Promise<EdgeTransaction>,
  broadcastTx(abcTransaction: EdgeTransaction): Promise<EdgeTransaction>,
  saveTx(abcTransaction: EdgeTransaction): Promise<void>,
  resyncBlockchain(): Promise<void>,
  dumpData(): EdgeDataDump,
  +getPaymentProtocolInfo?: (
    paymentProtocolUrl: string
  ) => Promise<EdgePaymentProtocolInfo>,
  getDisplayPrivateSeed(): string | null,
  getDisplayPublicSeed(): string | null,
  getTxids?: () => EdgeTxidMap
}

export type EdgeCurrencyPlugin = {
  +pluginName: string,
  +currencyInfo: EdgeCurrencyInfo,
  createPrivateKey(walletType: string): Object,
  derivePublicKey(walletInfo: EdgeWalletInfo): Object,
  makeEngine(
    walletInfo: EdgeWalletInfo,
    options: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine>,
  parseUri(uri: string): EdgeParsedUri,
  encodeUri(obj: EdgeEncodeUri): string,
  getSplittableTypes?: (walletInfo: EdgeWalletInfo) => Array<string>
}

export type EdgeCurrencyPluginFactory = {
  pluginType: 'currency',
  +pluginName: string,
  makePlugin(opts: EdgeCorePluginOptions): Promise<EdgeCurrencyPlugin>
}

// exchange plugin types ----------------------------------------------

export type EdgeExchangePairHint = {
  fromCurrency: string,
  toCurrency: string
}

export type EdgeExchangePair = {
  fromCurrency: string,
  toCurrency: string,
  rate: number
}

export type EdgeExchangePlugin = {
  exchangeInfo: { exchangeName: string },

  fetchExchangeRates(
    pairHints: Array<EdgeExchangePairHint>
  ): Promise<Array<EdgeExchangePair>>
}

export type EdgeExchangePluginFactory = {
  pluginType: 'exchange',
  makePlugin(opts: EdgeCorePluginOptions): Promise<EdgeExchangePlugin>
}

// legacy names -------------------------------------------------------

export type {
  EdgeConsole as AbcConsole,
  EdgeScryptFunction as AbcScryptFunction,
  EdgeSecp256k1 as AbcSecp256k1,
  EdgePbkdf2 as AbcPbkdf2,
  EdgeRawIo as AbcRawIo,
  EdgeIo as AbcIo,
  EdgeCorePluginFactory as AbcCorePluginFactory,
  EdgeCorePluginOptions as AbcCorePluginOptions,
  EdgeContextCallbacks as AbcContextCallbacks,
  EdgeContextOptions as AbcContextOptions,
  EdgeContext as AbcContext,
  EdgeExchangeSwapInfo as AbcExchangeSwapInfo,
  EdgePasswordRules as AbcPasswordRules,
  EdgeEdgeLoginRequest as AbcEdgeLoginRequest,
  EdgeEdgeLoginOptions as AbcEdgeLoginOptions,
  EdgeLoginMessages as AbcLoginMessages,
  EdgeWalletInfo as AbcWalletInfo,
  EdgeWalletInfoFull as AbcWalletInfoFull,
  EdgeWalletState as AbcWalletState,
  EdgeWalletStates as AbcWalletStates,
  EdgeAccountCallbacks as AbcAccountCallbacks,
  EdgeAccountOptions as AbcAccountOptions,
  EdgeCreateCurrencyWalletOptions as AbcCreateCurrencyWalletOptions,
  EdgeAccount as AbcAccount,
  EdgeLobby as AbcLobby,
  EdgeLoginRequest as AbcLoginRequest,
  EdgeCurrencyWallet as AbcCurrencyWallet,
  EdgeMetadata as AbcMetadata,
  EdgeSpendTarget as AbcSpendTarget,
  EdgeSpendInfo as AbcSpendInfo,
  EdgeTransaction as AbcTransaction,
  EdgeDenomination as AbcDenomination,
  EdgeMetaToken as AbcMetaToken,
  EdgeCurrencyInfo as AbcCurrencyInfo,
  EdgeParsedUri as AbcParsedUri,
  EdgeEncodeUri as AbcEncodeUri,
  EdgeFreshAddress as AbcFreshAddress,
  EdgeDataDump as AbcDataDump,
  EdgeReceiveAddress as AbcReceiveAddress,
  EdgeCurrencyEngineCallbacks as AbcCurrencyEngineCallbacks,
  EdgeCurrencyEngineOptions as AbcCurrencyEngineOptions,
  EdgeCurrencyEngine as AbcCurrencyEngine,
  EdgeCurrencyPlugin as AbcCurrencyPlugin,
  EdgeCurrencyPluginFactory as AbcCurrencyPluginFactory,
  EdgeExchangePairHint as AbcExchangePairHint,
  EdgeExchangePair as AbcExchangePair,
  EdgeExchangePlugin as AbcExchangePlugin,
  EdgeExchangePluginFactory as AbcExchangePluginFactory,
  // Wrong names:
  EdgeCorePluginFactory as AbcCorePlugin,
  EdgeContextOptions as AbcMakeContextOpts,
  EdgeCurrencyEngineOptions as AbcMakeEngineOptions,
  EdgeCurrencyEngineCallbacks as AbcCurrencyPluginCallbacks
}

/**
 * Created by paul on 8/26/17.
 */
// @flow

export type AbcMetadata = {
  name?:string,
  category?:string,
  notes?:string,
  amountFiat?:number,
  bizId?:number,
  miscJson?:string
}

export type AbcSpendTarget = {
  currencyCode?:string,
  destWallet?:any,
  publicAddress?:string,
  nativeAmount?:string,
  destMetadata?:AbcMetadata
}

export type AbcSpendInfo = {
  currencyCode?:string,
  noUnconfirmed?:boolean,
  spendTargets:Array<AbcSpendTarget>,
  networkFeeOption?:string,
  customNetworkFee?:string,
  metadata?:AbcMetadata
}

export type AbcTransaction = {
  txid: string,
  date: number,
  currencyCode: string,
  blockHeight: number,
  nativeAmount: string,
  networkFee: string,
  ourReceiveAddresses: Array<string>,
  signedTx: string,
  otherParams: any
}

export type AbcMakeContextOpts = {
  apiKey: string,
  appId: string,
  io: any,
  plugins: Array<any>,
}

export interface AbcDenomination {
  name:string,
  multiplier:string,
  symbol?:string
}

export interface AbcMetaToken {
  currencyCode:string,
  currencyName:string,
  denominations:Array<AbcDenomination>,
  contractAddress?:string,
  symbolImage?:string
}

export type AbcCurrencySettings = {
  addressExplorer: string,
  transactionExplorer: string,
  denomCurrencyCode: string,
  otherSettings: any
}

export type AbcCurrencyInfo = {
  walletTypes: Array<string>,
  currencyName: string,
  currencyCode: string,
  defaultSettings: AbcCurrencySettings,
  denominations: Array<AbcDenomination>,
  symbolImage?: string,
  metaTokens: Array<AbcMetaToken>
}

export type AbcParsedUri = {
  publicAddress:string,
  nativeAmount?:string,
  currencyCode?:string,
  label?:string,
  message?:string
}

export type AbcWalletInfo = {
  id?:string,
  type:string,
  keys:any
}

export type AbcEncodeUri = {
  publicAddress: string,
  nativeAmount?: string,
  label?: string,
  message?: string
}

export type AbcWalletState = {
  archived?: boolean,
  deleted?: boolean,
  sortIndex?: number
}

export type AbcWalletStates = {
  [walletId: string]: AbcWalletState
}

export interface AbcAccountCallbacks {
  onDataChanged():void,
  onKeyListChanged():void,
  onLoggedOut():void,
  onOTPRequired():void,
  onOTPSkew():void,
  onRemotePasswordChange():void
}

export type AbcAccountOptions = {
  otp: string,
  callbacks: AbcAccountCallbacks
}

export interface AbcAccount {
  // appId?:string,
  // username?:string,
  // loginKey?:string,
  // exchangeCache?:any,
  // loggedIn?:boolean,
  // edgeLogin?:boolean,
  keyLogin:boolean,
  pinLogin:boolean,
  passwordLogin:boolean,
  newAccount:boolean,
  recoveryLogin:boolean,
  isLoggedIn ():boolean,
  logout ():Promise<void>,
  passwordOk (password:string):Promise<boolean>,
  checkPassword (password:string):Promise<boolean>,
  passwordSetup (password:string):Promise<void>,
  changePassword (password:string):Promise<void>,
  pinSetup (password:string):Promise<void>,
  changePIN (password:string):Promise<void>,
  recovery2Set (questions:string, answers:string):Promise<string>,
  setupRecovery2Questions (questions:string, answers:string):Promise<string>,
  changeWalletStates (walletStates:AbcWalletStates):Promise<void>,
  changeKeyStates (walletStates:AbcWalletStates):Promise<void>,
  listWalletIds ():Array<string>,
  getWallet (id:string):AbcWalletInfo,
  getWalletInfo (id:string):AbcWalletInfo,
  getFirstWallet (type:string):AbcWalletInfo,
  getFirstWalletInfo (type:string):AbcWalletInfo,
  createWallet (type:string, keys:any):string
}

export interface AbcContext {

}

export interface AbcCurrencyEngine {
  updateSettings (settings:any):void,
  startEngine ():Promise<void>,
  killEngine ():void,
  getBlockHeight ():number,
  enableTokens (tokens:Array<string>):void,
  getTokenStatus (token:string):boolean,
  getBalance (options:any):string,
  getNumTransactions (options:any):number,
  getTransactions (options:any):Promise<Array<AbcTransaction>>,
  getFreshAddress (options:any):string,
  addGapLimitAddresses (addresses:Array<string>, options:any):void,
  isAddressUsed (address:string, options:any):boolean,
  makeSpend (abcSpendInfo:AbcSpendInfo):Promise<AbcTransaction>,
  signTx (abcTransaction:AbcTransaction):Promise<AbcTransaction>,
  broadcastTx (abcTransaction:AbcTransaction):Promise<AbcTransaction>,
  saveTx (abcTransaction:AbcTransaction):Promise<void>
}

export type AbcCurrencyPlugin = {
  pluginName: string,
  currencyInfo: AbcCurrencyInfo,
  createPrivateKey (walletType: string): any,
  derivePublicKey (walletInfo:AbcWalletInfo): any,
  makeEngine (keyInfo: any, opts: any):AbcCurrencyEngine,
  parseUri (uri:string):AbcParsedUri,
  encodeUri (obj:AbcEncodeUri):string
}

export type AbcMakeCurrencyPlugin = (opts:any) => Promise<AbcCurrencyPlugin>

export type AbcCurrencyPluginCallbacks = {
  onBlockHeightChanged (blockHeight: number): void,
  onTransactionsChanged (abcTransactions: Array<AbcTransaction>): void,
  onBalanceChanged (currencyCode: string, nativeBalance: string): void,
  onAddressesChecked (progressRatio: number): void
}

export type AbcMakeEngineOptions = {
  walletLocalFolder: any,
  callbacks: AbcCurrencyPluginCallbacks,
  optionalSettings?: AbcCurrencySettings
}

export interface AbcCurrencyPluginFactory {
  static makePlugin (opts:{}):Promise<AbcCurrencyPlugin>
}

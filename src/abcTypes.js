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

const abcTransaction:AbcTransaction = {
  txid: '',
  date: 1,
  currencyCode: 'ETH',
  blockHeight: 1,
  nativeAmount: '',
  networkFee: '',
  ourReceiveAddresses: [''],
  signedTx: 'unsigned_right_now',
  otherParams: {}
}

console.log(abcTransaction)

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
  type:string,
  keys:any
}

export type AbcEncodeUri = {
  publicAddress: string,
  nativeAmount?: string,
  label?: string,
  message?: string
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

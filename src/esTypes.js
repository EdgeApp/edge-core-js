/**
 * Created by paul on 8/26/17.
 */
// @flow

export type EsMetadata = {
  name?:string,
  category?:string,
  notes?:string,
  amountFiat?:number,
  bizId?:number,
  miscJson?:string
}

export type EsSpendTarget = {
  currencyCode?:string,
  destWallet?:any,
  publicAddress?:string,
  nativeAmount?:string,
  destMetadata?:EsMetadata
}

export type EsSpendInfo = {
  currencyCode?:string,
  noUnconfirmed?:boolean,
  spendTargets:Array<EsSpendTarget>,
  networkFeeOption?:string,
  customNetworkFee?:string,
  metadata?:EsMetadata
}

export type EsTransaction = {
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

const esTransaction:EsTransaction = {
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

console.log(esTransaction)

export interface EsDenomination {
  name:string,
  multiplier:string,
  symbol?:string
}

export interface EsMetaToken {
  currencyCode:string,
  currencyName:string,
  denominations:Array<EsDenomination>,
  contractAddress?:string,
  symbolImage?:string
}

export type EsCurrencySettings = {
  addressExplorer: string,
  transactionExplorer: string,
  denomCurrencyCode: string,
  otherSettings: any
}

export type EsCurrencyInfo = {
  walletTypes: Array<string>,
  currencyName: string,
  currencyCode: string,
  defaultSettings: EsCurrencySettings,
  denominations: Array<EsDenomination>,
  symbolImage?: string,
  metaTokens: Array<EsMetaToken>
}

export type EsParsedUri = {
  publicAddress:string,
  nativeAmount?:string,
  currencyCode?:string,
  label?:string,
  message?:string
}

export type EsWalletInfo = {
  type:string,
  keys:any
}

export type EsEncodeUri = {
  publicAddress: string,
  nativeAmount?: string,
  label?: string,
  message?: string
}

export interface EsCurrencyEngine {
  updateSettings (settings:any):void,
  startEngine ():Promise<void>,
  killEngine ():void,
  getBlockHeight ():number,
  enableTokens (tokens:Array<string>):void,
  getTokenStatus (token:string):boolean,
  getBalance (options:any):string,
  getNumTransactions (options:any):number,
  getTransactions (options:any):Promise<Array<EsTransaction>>,
  getFreshAddress (options:any):string,
  addGapLimitAddresses (addresses:Array<string>, options:any):void,
  isAddressUsed (address:string, options:any):boolean,
  makeSpend (esSpendInfo:EsSpendInfo):Promise<EsTransaction>,
  signTx (esTransaction:EsTransaction):Promise<EsTransaction>,
  broadcastTx (esTransaction:EsTransaction):Promise<EsTransaction>,
  saveTx (esTransaction:EsTransaction):Promise<void>
}

export type EsCurrencyPlugin = {
  createPrivateKey (walletType: string): any,
  derivePublicKey (walletInfo:EsWalletInfo): any,
  makeEngine (keyInfo: any, opts: any):EsCurrencyEngine,
  parseUri (uri:string):EsParsedUri,
  encodeUri (obj:EsEncodeUri):string
}

export type EsMakeCurrencyPlugin = (opts:any) => Promise<EsCurrencyPlugin>


import {
  asArray,
  asMap,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'

export const asCachedDenomination = asObject({
  multiplier: asString,
  name: asString,
  symbol: asOptional(asString)
})

export const asCachedToken = asObject({
  currencyCode: asString,
  displayName: asString,
  denominations: asArray(asCachedDenomination),
  networkLocation: asOptional(asObject({}))
})

export const asCachedSubscribedAddress = asObject({
  address: asString,
  checkpoint: asOptional(asString)
})

export const asCachedWallet = asObject({
  id: asString,
  type: asString,
  name: asOptional(asString),
  pluginId: asString,
  fiatCurrencyCode: asString,
  // tokenId (or "null" for parent currency) -> nativeAmount
  balances: asMap(asString),
  enabledTokenIds: asArray(asString),
  customTokens: asMap(asCachedToken),
  // Change server subscriptions for lazy engine instantiation
  subscribedAddresses: asOptional(asArray(asCachedSubscribedAddress)),
  seenTxCheckpoint: asOptional(asString)
})

export const asWalletCacheFile = asObject({
  version: asValue(1),
  // pluginId -> tokenId -> token
  tokens: asMap(asMap(asCachedToken)),
  wallets: asArray(asCachedWallet)
})

export type CachedDenomination = ReturnType<typeof asCachedDenomination>
export type CachedToken = ReturnType<typeof asCachedToken>
export type CachedSubscribedAddress = ReturnType<
  typeof asCachedSubscribedAddress
>
export type CachedWallet = ReturnType<typeof asCachedWallet>
export type WalletCacheFile = ReturnType<typeof asWalletCacheFile>

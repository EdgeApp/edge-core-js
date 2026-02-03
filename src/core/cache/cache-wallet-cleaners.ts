import { asArray, asObject, asOptional, asString, asValue } from 'cleaners'

import { asEdgeToken } from '../account/account-cleaners'

export const asCachedWallet = asObject({
  id: asString,
  type: asString,
  name: asOptional(asString),
  pluginId: asString,
  fiatCurrencyCode: asString,
  // tokenId (or "null" for parent currency) -> nativeAmount
  balances: asObject(asString),
  enabledTokenIds: asArray(asString)
})

export const asWalletCacheFile = asObject({
  version: asValue(1),
  // pluginId -> tokenId -> token
  tokens: asObject(asObject(asEdgeToken)),
  wallets: asArray(asCachedWallet)
})

export type CachedWallet = ReturnType<typeof asCachedWallet>
export type WalletCacheFile = ReturnType<typeof asWalletCacheFile>

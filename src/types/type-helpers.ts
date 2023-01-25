import type { EdgeCurrencyInfo, EdgeTokenMap } from './types'

/**
 * Translates a currency code to a tokenId,
 * and then back again for bi-directional backwards compatibility.
 */
export function upgradeCurrencyCode(opts: {
  allTokens: EdgeTokenMap
  currencyInfo: EdgeCurrencyInfo
  currencyCode?: string
  tokenId?: string
}): { currencyCode: string; tokenId?: string } {
  const { currencyInfo, allTokens } = opts

  // Find the tokenId:
  let tokenId = opts.tokenId
  if (
    tokenId == null &&
    opts.currencyCode != null &&
    opts.currencyCode !== currencyInfo.currencyCode
  ) {
    tokenId = Object.keys(allTokens).find(
      tokenId => allTokens[tokenId].currencyCode === opts.currencyCode
    )
  }

  // Get the currency code:
  const { currencyCode } = tokenId == null ? currencyInfo : allTokens[tokenId]

  return { currencyCode, tokenId }
}

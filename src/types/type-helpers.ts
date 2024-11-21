import type {
  EdgeCurrencyInfo,
  EdgeSwapQuote,
  EdgeTokenId,
  EdgeTokenMap,
  EdgeTransaction
} from './types'

/**
 * Translates a currency code to a tokenId,
 * and then back again for bi-directional backwards compatibility.
 */
export function upgradeCurrencyCode(opts: {
  allTokens: EdgeTokenMap
  currencyInfo: EdgeCurrencyInfo
  currencyCode?: string
  tokenId?: EdgeTokenId
}): { currencyCode: string; tokenId: EdgeTokenId } {
  const { currencyInfo, allTokens } = opts

  // Find the tokenId:
  let tokenId = opts.tokenId
  if (
    tokenId === undefined &&
    opts.currencyCode != null &&
    opts.currencyCode !== currencyInfo.currencyCode
  ) {
    tokenId = Object.keys(allTokens).find(
      tokenId => allTokens[tokenId].currencyCode === opts.currencyCode
    )
  }

  // Get the currency code:
  const { currencyCode } = tokenId == null ? currencyInfo : allTokens[tokenId]

  return { currencyCode, tokenId: tokenId ?? null }
}

export function upgradeSwapQuote(quote: EdgeSwapQuote): EdgeSwapQuote {
  if (quote.networkFee != null && quote.networkFee.tokenId == null) {
    quote.networkFee.tokenId = quote.request.fromTokenId
  }
  return quote
}

export const upgradeTxNetworkFees = (tx: EdgeTransaction): void => {
  if (tx.networkFees == null || tx.networkFees.length === 0) {
    tx.networkFees = [
      {
        tokenId: tx.tokenId,
        nativeAmount: tx.networkFee
      }
    ]
    if (tx.parentNetworkFee != null) {
      tx.networkFees.push({ tokenId: null, nativeAmount: tx.parentNetworkFee })
    }
  }
}

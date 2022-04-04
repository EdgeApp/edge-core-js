// @flow

import {
  type EdgeCurrencyInfo,
  type EdgeTokenMap
} from '../../../types/types.js'

function flipTokenMap(
  tokens: EdgeTokenMap
): { [currencyCode: string]: string } {
  const out: { [currencyCode: string]: string } = {}
  for (const tokenId of Object.keys(tokens)) {
    const token = tokens[tokenId]
    out[token.currencyCode] = tokenId
  }
  return out
}

export function currencyCodesToTokenIds(
  builtinTokens: EdgeTokenMap = {},
  customTokens: EdgeTokenMap = {},
  currencyInfo: EdgeCurrencyInfo,
  currencyCodes: string[]
): string[] {
  const builtinIds = flipTokenMap(builtinTokens)
  const customIds = flipTokenMap(customTokens)

  const out: string[] = []
  for (const currencyCode of currencyCodes) {
    if (currencyCode === currencyInfo.currencyCode) {
      out.push('')
    } else {
      const tokenId = customIds[currencyCode] ?? builtinIds[currencyCode]
      if (tokenId != null) out.push(tokenId)
    }
  }
  return out
}

export function tokenIdsToCurrencyCodes(
  builtinTokens: EdgeTokenMap = {},
  customTokens: EdgeTokenMap = {},
  currencyInfo: EdgeCurrencyInfo,
  tokenIds: string[]
): string[] {
  const out: string[] = []
  for (const tokenId of tokenIds) {
    if (tokenId === '') {
      out.push(currencyInfo.currencyCode)
    } else {
      const token = customTokens[tokenId] ?? builtinTokens[tokenId]
      if (token != null) out.push(token.currencyCode)
    }
  }
  return out
}

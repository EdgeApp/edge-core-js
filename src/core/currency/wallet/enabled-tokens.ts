import { EdgeCurrencyInfo, EdgeTokenMap } from '../../../types/types'

function flipTokenMap(tokens: EdgeTokenMap): {
  [currencyCode: string]: string
} {
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
    const tokenId = customIds[currencyCode] ?? builtinIds[currencyCode]
    if (tokenId != null) out.push(tokenId)
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
    const token = customTokens[tokenId] ?? builtinTokens[tokenId]
    if (token != null) out.push(token.currencyCode)
  }
  return out
}

/**
 * Returns the unique items of an array,
 * optionally removing the items in `omit`.
 */
export function uniqueStrings(array: string[], omit: string[] = []): string[] {
  const table = new Set(omit)

  const out: string[] = []
  for (const item of array) {
    if (table.has(item)) continue
    table.add(item)
    out.push(item)
  }
  return out
}

// @flow

import { asMaybe, asObject, asString } from 'cleaners'

import {
  type EdgeMetaToken,
  type EdgeToken,
  type EdgeTokenInfo,
  type EdgeTokenMap
} from '../../types/types.js'

/**
 * The `networkLocation` field is untyped,
 * but many currency plugins will put a contract address in there.
 */
const asMaybeContractLocation = asMaybe(
  asObject({
    contractAddress: asString
  })
)

export function contractToTokenId(contractAddress: string): string {
  return contractAddress.toLowerCase().replace(/^0x/, '')
}

export function upgradeTokenInfo(info: EdgeTokenInfo): EdgeToken {
  const { currencyCode, currencyName, contractAddress, multiplier } = info

  return {
    currencyCode,
    denominations: [{ multiplier, name: currencyCode }],
    displayName: currencyName,
    networkLocation: { contractAddress }
  }
}

export function makeMetaToken(token: EdgeToken): EdgeMetaToken {
  const { currencyCode, displayName, denominations, networkLocation } = token
  const cleanLocation = asMaybeContractLocation(networkLocation)

  return {
    currencyCode,
    currencyName: displayName,
    denominations,
    contractAddress: cleanLocation?.contractAddress
  }
}

export function makeMetaTokens(tokens: EdgeTokenMap = {}): EdgeMetaToken[] {
  const out: EdgeMetaToken[] = []
  for (const tokenId of Object.keys(tokens)) {
    out.push(makeMetaToken(tokens[tokenId]))
  }
  return out
}

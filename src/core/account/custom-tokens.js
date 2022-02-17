// @flow

import { asMaybe, asObject, asString } from 'cleaners'

import {
  type EdgeMetaToken,
  type EdgeToken,
  type EdgeTokenInfo,
  type EdgeTokenMap
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'

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

function upgradeMetaTokens(metaTokens: EdgeMetaToken[]): EdgeTokenMap {
  const out: EdgeTokenMap = {}
  for (const metaToken of metaTokens) {
    const { contractAddress } = metaToken
    if (contractAddress == null) continue
    out[contractToTokenId(contractAddress)] = {
      currencyCode: metaToken.currencyCode,
      denominations: metaToken.denominations,
      displayName: metaToken.currencyName,
      networkLocation: { contractAddress: metaToken.contractAddress }
    }
  }
  return out
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

export async function loadBuiltinTokens(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { dispatch, state } = ai.props

  // Load builtin tokens:
  await Promise.all(
    Object.keys(state.plugins.currency).map(async pluginId => {
      const plugin = state.plugins.currency[pluginId]
      const tokens: EdgeTokenMap =
        plugin.getBuiltinTokens == null
          ? upgradeMetaTokens(plugin.currencyInfo.metaTokens)
          : await plugin.getBuiltinTokens()
      dispatch({
        type: 'ACCOUNT_BUILTIN_TOKENS_LOADED',
        payload: { accountId, pluginId, tokens }
      })
    })
  )
}

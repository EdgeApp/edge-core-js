import { asMaybe, asObject, asString } from 'cleaners'

import {
  EdgeCurrencyEngine,
  EdgeMetaToken,
  EdgePluginMap,
  EdgeToken,
  EdgeTokenInfo,
  EdgeTokenMap
} from '../../types/types'
import { makeJsonFile } from '../../util/file-helpers'
import {
  getCurrencyTools,
  maybeFindCurrencyPluginId
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { getStorageWalletDisklet } from '../storage/storage-selectors'
import { asCustomTokensFile, asGuiSettingsFile } from './account-cleaners'

const customTokensFile = makeJsonFile(asCustomTokensFile)
const guiSettingsFile = makeJsonFile(asGuiSettingsFile)
const CUSTOM_TOKENS_FILE = 'CustomTokens.json'
const GUI_SETTINGS_FILE = 'Settings.json'

/**
 * The `networkLocation` field is untyped,
 * but many currency plugins will put a contract address in there.
 */
const asMaybeContractLocation = asMaybe(
  asObject({
    contractAddress: asString
  })
)

/**
 * We need to validate the token before we can add it.
 *
 * If the plugin has a `getTokenId` method, just use that.
 *
 * Otherwise, we need to call `EdgeCurrencyEngine.addCustomToken`
 * to validate the contract address, and then guess the tokenId from that.
 */
export async function getTokenId(
  ai: ApiInput,
  pluginId: string,
  token: EdgeToken
): Promise<string> {
  // The normal code path:
  const tools = await getCurrencyTools(ai, pluginId)
  if (tools.getTokenId != null) {
    return await tools.getTokenId(token)
  }

  // Find an engine (any engine) to validate our token:
  const engine = findEngine(ai, pluginId)
  if (engine == null) {
    throw new Error(
      'A wallet must exist before adding tokens to a legacy currency plugin'
    )
  }
  if (engine.addCustomToken == null) {
    throw new Error(`${pluginId} doesn't support tokens`)
  }

  // Validate the token:
  const tokenInfo = makeTokenInfo(token)
  if (tokenInfo == null) {
    throw new Error(
      'A token must have a contract address to be added to a legacy currency plugin'
    )
  }
  await engine.addCustomToken({ ...tokenInfo, ...token })

  return contractToTokenId(tokenInfo.contractAddress)
}

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

export function makeTokenInfo(token: EdgeToken): EdgeTokenInfo | undefined {
  const { currencyCode, displayName, denominations, networkLocation } = token
  const cleanLocation = asMaybeContractLocation(networkLocation)
  if (cleanLocation == null) return

  return {
    currencyCode,
    currencyName: displayName,
    multiplier: denominations[0].multiplier,
    contractAddress: cleanLocation.contractAddress
  }
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

function findEngine(
  ai: ApiInput,
  pluginId: string
): EdgeCurrencyEngine | undefined {
  for (const walletId of Object.keys(ai.props.state.currency.wallets)) {
    const walletOutput = ai.props.output.currency.wallets[walletId]
    if (
      walletOutput?.engine != null &&
      ai.props.state.currency.wallets[walletId].pluginId === pluginId
    ) {
      return walletOutput.engine
    }
  }
}

async function loadGuiTokens(
  ai: ApiInput,
  accountId: string
): Promise<EdgePluginMap<EdgeTokenMap>> {
  const { state } = ai.props
  const { accountWalletInfo } = state.accounts[accountId]
  const disklet = getStorageWalletDisklet(state, accountWalletInfo.id)

  const file = await guiSettingsFile.load(disklet, GUI_SETTINGS_FILE)
  if (file == null) return {}

  const out: EdgePluginMap<EdgeTokenMap> = {}
  for (const guiToken of file.customTokens) {
    if (!guiToken.isVisible) continue

    // Find the plugin:
    const pluginId = maybeFindCurrencyPluginId(
      state.plugins.currency,
      guiToken.walletType
    )
    if (pluginId == null) continue
    if (out[pluginId] == null) out[pluginId] = {}

    // Add it to the list:
    const tokenId = contractToTokenId(guiToken.contractAddress)
    out[pluginId][tokenId] = {
      currencyCode: guiToken.currencyCode,
      denominations: guiToken.denominations,
      displayName: guiToken.currencyName,
      networkLocation: {
        contractAddress: guiToken.contractAddress
      }
    }
  }
  return out
}

export async function loadCustomTokens(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { dispatch, state } = ai.props
  const { accountWalletInfo } = state.accounts[accountId]
  const disklet = getStorageWalletDisklet(state, accountWalletInfo.id)

  // Load the file:
  const file = await customTokensFile.load(disklet, CUSTOM_TOKENS_FILE)
  if (file != null) {
    const { customTokens } = file
    dispatch({
      type: 'ACCOUNT_CUSTOM_TOKENS_LOADED',
      payload: { accountId, customTokens }
    })
  } else {
    // Fall back on the legacy file:
    const customTokens = await loadGuiTokens(ai, accountId)
    dispatch({
      type: 'ACCOUNT_CUSTOM_TOKENS_LOADED',
      payload: { accountId, customTokens }
    })
  }
}

export async function saveCustomTokens(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { state } = ai.props
  const { accountWalletInfo } = state.accounts[accountId]
  const disklet = getStorageWalletDisklet(state, accountWalletInfo.id)
  const { customTokens } = ai.props.state.accounts[accountId]

  // Refresh the file:
  const file = await customTokensFile.load(disklet, CUSTOM_TOKENS_FILE)
  await customTokensFile.save(disklet, CUSTOM_TOKENS_FILE, {
    ...file,
    customTokens
  })
}

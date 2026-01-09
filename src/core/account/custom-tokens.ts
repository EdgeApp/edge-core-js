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
import { asTokensFile } from '../currency/wallet/currency-wallet-cleaners'
import { TOKENS_FILE } from '../currency/wallet/currency-wallet-files'
import {
  getCurrencyTools,
  maybeFindCurrencyPluginId
} from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { getStorageWalletDisklet } from '../storage/storage-selectors'
import { asCustomTokensFile, asGuiSettingsFile } from './account-cleaners'

const customTokensFile = makeJsonFile(asCustomTokensFile)
const guiSettingsFile = makeJsonFile(asGuiSettingsFile)
const tokensFile = makeJsonFile(asTokensFile)
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

function contractToTokenId(contractAddress: string): string {
  return contractAddress.toLowerCase().replace(/^0x/, '')
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
          ? upgradeMetaTokens(plugin.currencyInfo.metaTokens ?? [])
          : await plugin.getBuiltinTokens()
      dispatch({
        type: 'ACCOUNT_BUILTIN_TOKENS_LOADED',
        payload: { accountId, pluginId, tokens }
      })
    })
  )
}

export function findEngine(
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

// Lazy loader for builtinTokens.json
let builtinTokensCache: EdgePluginMap<EdgeTokenMap> | null = null

export function loadBuiltinTokensJson(): EdgePluginMap<EdgeTokenMap> {
  if (builtinTokensCache != null) return builtinTokensCache

  // Use require for lazy loading (only loads when function is called)
  // Works well with CommonJS output from Rollup
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
  builtinTokensCache = require('./builtinTokens.json')
  return builtinTokensCache as EdgePluginMap<EdgeTokenMap>
}

// Get enabled tokenIds from wallet files on disk
async function getEnabledTokenIdsFromWalletFiles(
  ai: ApiInput,
  accountId: string
): Promise<Map<string, Set<string>>> {
  const { state } = ai.props
  const accountState = state.accounts[accountId]
  const enabledTokensByPlugin = new Map<string, Set<string>>()

  // Get all wallet IDs for this account
  const walletIds = accountState.currencyWalletIds

  for (const walletId of walletIds) {
    const walletState = state.currency.wallets[walletId]
    if (walletState == null) continue

    const { pluginId } = walletState
    const disklet = getStorageWalletDisklet(state, walletId)

    // Try to load the modern tokens file
    const tokensData = await tokensFile.load(disklet, TOKENS_FILE)
    if (tokensData != null) {
      let tokenSet = enabledTokensByPlugin.get(pluginId)
      if (tokenSet == null) {
        tokenSet = new Set()
        enabledTokensByPlugin.set(pluginId, tokenSet)
      }
      for (const tokenId of tokensData.enabledTokenIds) {
        tokenSet.add(tokenId)
      }
    }
  }

  return enabledTokensByPlugin
}

export async function migrateEnabledTokensToCustomTokens(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { dispatch, state } = ai.props
  const accountState = state.accounts[accountId]
  const { customTokens } = accountState

  // Get all enabled tokenIds grouped by pluginId
  const enabledTokensByPlugin = await getEnabledTokenIdsFromWalletFiles(
    ai,
    accountId
  )

  // Check if any migration is needed
  let needsMigration = false
  for (const [pluginId, enabledTokenIds] of enabledTokensByPlugin) {
    const custom = customTokens[pluginId] ?? {}
    for (const tokenId of enabledTokenIds) {
      if (custom[tokenId] == null) {
        needsMigration = true
        break
      }
    }
    if (needsMigration) break
  }

  // If no migration needed, return early (lazy loading optimization)
  if (!needsMigration) return

  // Lazy load builtinTokens.json only if migration is needed
  const builtinTokens = loadBuiltinTokensJson()

  // Migrate missing tokens, batched per plugin
  let migratedCount = 0
  for (const [pluginId, enabledTokenIds] of enabledTokensByPlugin) {
    const builtin = builtinTokens[pluginId] ?? {}
    const custom = customTokens[pluginId] ?? {}

    const tokensToAdd: EdgeTokenMap = {}
    for (const tokenId of enabledTokenIds) {
      if (custom[tokenId] != null) continue
      const token = builtin[tokenId]
      if (token == null) continue
      tokensToAdd[tokenId] = token
    }

    const count = Object.keys(tokensToAdd).length
    if (count > 0) {
      dispatch({
        type: 'ACCOUNT_CUSTOM_TOKENS_ADDED',
        payload: { accountId, pluginId, tokens: tokensToAdd }
      })
      migratedCount += count
    }
  }

  if (migratedCount > 0) {
    await saveCustomTokens(ai, accountId)
  }
}

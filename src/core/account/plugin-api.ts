import { Bridgeable, bridgifyObject } from 'yaob'

import {
  EdgeCurrencyConfig,
  EdgeCurrencyInfo,
  EdgeGetTokenDetailsFilter,
  EdgeOtherMethods,
  EdgeSwapConfig,
  EdgeSwapInfo,
  EdgeToken,
  EdgeTokenMap
} from '../../types/types'
import { uniqueStrings } from '../currency/wallet/enabled-tokens'
import { getCurrencyTools } from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'
import { changePluginUserSettings, changeSwapSettings } from './account-files'
import { getTokenId, saveCustomTokens } from './custom-tokens'

const emptyTokens: EdgeTokenMap = {}
const emptyTokenIds: string[] = []

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyConfig
  extends Bridgeable<EdgeCurrencyConfig>
  implements EdgeCurrencyConfig
{
  _ai: ApiInput
  _accountId: string
  _pluginId: string

  otherMethods: EdgeOtherMethods

  constructor(ai: ApiInput, accountId: string, pluginId: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginId = pluginId

    const { otherMethods } = ai.props.state.plugins.currency[pluginId]
    if (otherMethods != null) {
      bridgifyObject(otherMethods)
      this.otherMethods = otherMethods
    } else {
      this.otherMethods = {}
    }
  }

  get currencyInfo(): EdgeCurrencyInfo {
    return this._ai.props.state.plugins.currency[this._pluginId].currencyInfo
  }

  get allTokens(): EdgeTokenMap {
    const { state } = this._ai.props
    const { _accountId: accountId, _pluginId: pluginId } = this
    return state.accounts[accountId].allTokens[pluginId]
  }

  get customTokens(): EdgeTokenMap {
    const { state } = this._ai.props
    const { _accountId: accountId, _pluginId: pluginId } = this
    return state.accounts[accountId].customTokens[pluginId] ?? emptyTokens
  }

  async getTokenDetails(
    filter: EdgeGetTokenDetailsFilter
  ): Promise<EdgeToken[]> {
    const { _ai: ai, _pluginId: pluginId } = this
    const tools = await getCurrencyTools(ai, pluginId)
    if (tools.getTokenDetails == null) return []
    return await tools.getTokenDetails(filter)
  }

  async getTokenId(token: EdgeToken): Promise<string> {
    const { _ai: ai, _pluginId: pluginId } = this
    return await getTokenId(ai, pluginId, token)
  }

  async addCustomToken(token: EdgeToken): Promise<string> {
    const { _accountId: accountId, _ai: ai, _pluginId: pluginId } = this
    const tokenId = await getTokenId(ai, pluginId, token)

    ai.props.dispatch({
      type: 'ACCOUNT_CUSTOM_TOKEN_ADDED',
      payload: { accountId, pluginId, tokenId, token }
    })
    return tokenId
  }

  async addCustomTokens(tokens: EdgeToken[]): Promise<string[]> {
    const { _accountId: accountId, _ai: ai, _pluginId: pluginId } = this

    const tokenIds = await Promise.all(
      tokens.map(async token => await getTokenId(ai, pluginId, token))
    )

    const tokenMap: EdgeTokenMap = {}
    for (let i = 0; i < tokens.length; i++) {
      tokenMap[tokenIds[i]] = tokens[i]
    }

    ai.props.dispatch({
      type: 'ACCOUNT_CUSTOM_TOKENS_ADDED',
      payload: { accountId, pluginId, tokens: tokenMap }
    })
    await saveCustomTokens(ai, accountId)
    return tokenIds
  }

  async changeCustomToken(tokenId: string, token: EdgeToken): Promise<void> {
    const { _accountId: accountId, _ai: ai, _pluginId: pluginId } = this
    const oldToken =
      ai.props.state.accounts[accountId].customTokens[pluginId][tokenId]
    if (oldToken == null) {
      throw new Error(`There is no token with id "${tokenId}"`)
    }
    const newTokenId = await getTokenId(ai, pluginId, token)
    ai.props.dispatch({
      type: 'ACCOUNT_CUSTOM_TOKEN_ADDED',
      payload: { accountId, pluginId, tokenId: newTokenId, token }
    })

    if (newTokenId !== tokenId) {
      // Enable the new token if the tokenId changed:
      const { wallets } = ai.props.state.currency
      for (const walletId of Object.keys(wallets)) {
        const walletState = wallets[walletId]
        if (
          walletState.accountId !== accountId ||
          walletState.pluginId !== pluginId ||
          !walletState.enabledTokenIds.includes(tokenId)
        ) {
          continue
        }

        // We rely on redux to check for actual differences,
        // and to trigger the matching disk & engine updates if needed:
        const shortId = walletId.slice(0, 2)
        ai.props.log.warn(
          `enabledTokenIds: ${shortId} changeCustomToken edited id`
        )
        ai.props.dispatch({
          type: 'CURRENCY_WALLET_ENABLED_TOKENS_CHANGED',
          payload: {
            walletId,
            enabledTokenIds: uniqueStrings(
              [...walletState.enabledTokenIds, newTokenId],
              [tokenId]
            )
          }
        })
      }

      // Remove the old token if the tokenId changed:
      ai.props.dispatch({
        type: 'ACCOUNT_CUSTOM_TOKEN_REMOVED',
        payload: { accountId, pluginId, tokenId }
      })
    }
  }

  async removeCustomToken(tokenId: string): Promise<void> {
    const { _accountId: accountId, _ai: ai, _pluginId: pluginId } = this

    ai.props.dispatch({
      type: 'ACCOUNT_CUSTOM_TOKEN_REMOVED',
      payload: { accountId, pluginId, tokenId }
    })
  }

  get alwaysEnabledTokenIds(): string[] {
    const { state } = this._ai.props
    const { _accountId: accountId, _pluginId: pluginId } = this
    return (
      state.accounts[accountId].alwaysEnabledTokenIds[pluginId] ?? emptyTokenIds
    )
  }

  async changeAlwaysEnabledTokenIds(tokenIds: string[]): Promise<void> {
    const { _accountId: accountId, _ai: ai, _pluginId: pluginId } = this

    ai.props.dispatch({
      type: 'ACCOUNT_ALWAYS_ENABLED_TOKENS_CHANGED',
      payload: { accountId, pluginId, tokenIds }
    })
  }

  get userSettings(): object {
    const accountState = this._ai.props.state.accounts[this._accountId]
    return accountState.userSettings[this._pluginId]
  }

  async changeUserSettings(settings: object): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginId,
      settings
    )
  }

  async importKey(
    userInput: string,
    opts: { keyOptions?: object } = {}
  ): Promise<object> {
    const tools = await getCurrencyTools(this._ai, this._pluginId)

    if (tools.importPrivateKey == null) {
      throw new Error('This wallet does not support importing keys')
    }
    const keys = await tools.importPrivateKey(userInput, opts.keyOptions)
    return { ...keys, imported: true }
  }
}

export class SwapConfig extends Bridgeable<EdgeSwapConfig> {
  _ai: ApiInput
  _accountId: string
  _pluginId: string

  constructor(ai: ApiInput, accountId: string, pluginId: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginId = pluginId
  }

  get enabled(): boolean {
    const { swapSettings } = this._ai.props.state.accounts[this._accountId]
    const { enabled = true } =
      swapSettings[this._pluginId] != null ? swapSettings[this._pluginId] : {}
    return enabled
  }

  get needsActivation(): boolean {
    const plugin = this._ai.props.state.plugins.swap[this._pluginId]
    if (plugin.checkSettings == null) return false

    const accountState = this._ai.props.state.accounts[this._accountId]
    const settings = accountState.userSettings[this._pluginId] ?? {}
    return plugin.checkSettings(settings).needsActivation ?? false
  }

  get swapInfo(): EdgeSwapInfo {
    return this._ai.props.state.plugins.swap[this._pluginId].swapInfo
  }

  get userSettings(): object {
    const accountState = this._ai.props.state.accounts[this._accountId]
    return accountState.userSettings[this._pluginId]
  }

  async changeEnabled(enabled: boolean): Promise<void> {
    const account = this._ai.props.state.accounts[this._accountId]
    return await changeSwapSettings(this._ai, this._accountId, this._pluginId, {
      ...account.swapSettings[this._pluginId],
      enabled
    })
  }

  async changeUserSettings(settings: object): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginId,
      settings
    )
  }
}

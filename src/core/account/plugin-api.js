// @flow

import { Bridgeable, bridgifyObject } from 'yaob'

import {
  type EdgeCurrencyConfig,
  type EdgeCurrencyInfo,
  type EdgeOtherMethods,
  type EdgeSwapConfig,
  type EdgeSwapInfo,
  type EdgeToken,
  type EdgeTokenMap,
  type JsonObject
} from '../../types/types.js'
import { getCurrencyTools } from '../plugins/plugins-selectors.js'
import { type ApiInput } from '../root-pixie.js'
import {
  changePluginUserSettings,
  changeSwapSettings
} from './account-files.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyConfig extends Bridgeable<EdgeCurrencyConfig> {
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

  get builtinTokens(): EdgeTokenMap {
    return {}
  }

  get customTokens(): EdgeTokenMap {
    return {}
  }

  async addCustomToken(token: EdgeToken): Promise<string> {
    return ''
  }

  async changeCustomToken(tokenId: string, token: EdgeToken): Promise<void> {}

  async removeCustomToken(tokenId: string): Promise<void> {}

  get userSettings(): JsonObject {
    const accountState = this._ai.props.state.accounts[this._accountId]
    return accountState.userSettings[this._pluginId]
  }

  async changeUserSettings(settings: JsonObject): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginId,
      settings
    )
  }

  async importKey(
    userInput: string,
    opts: { keyOptions?: JsonObject } = {}
  ): Promise<JsonObject> {
    const tools = await getCurrencyTools(this._ai, this.currencyInfo.walletType)

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
    const settings = accountState.userSettings[this._pluginId] || {}
    return !!plugin.checkSettings(settings).needsActivation
  }

  get swapInfo(): EdgeSwapInfo {
    return this._ai.props.state.plugins.swap[this._pluginId].swapInfo
  }

  get userSettings(): JsonObject {
    const accountState = this._ai.props.state.accounts[this._accountId]
    return accountState.userSettings[this._pluginId]
  }

  async changeEnabled(enabled: boolean): Promise<void> {
    const account = this._ai.props.state.accounts[this._accountId]
    return changeSwapSettings(this._ai, this._accountId, this._pluginId, {
      ...account.swapSettings[this._pluginId],
      enabled
    })
  }

  async changeUserSettings(settings: JsonObject): Promise<void> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginId,
      settings
    )
  }
}

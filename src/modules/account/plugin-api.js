// @flow

import { Bridgeable } from 'yaob'

import {
  type EdgeCurrencyConfig,
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeSwapConfig,
  type EdgeSwapInfo
} from '../../index.js'
import { deprecate } from '../../util/deprecate.js'
import { type ApiInput } from '../root.js'
import { changePluginSettings } from './account-files.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyConfig extends Bridgeable<EdgeCurrencyConfig> {
  _ai: ApiInput
  _accountId: string
  _plugin: EdgeCurrencyPlugin

  constructor (ai: ApiInput, accountId: string, plugin: EdgeCurrencyPlugin) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._plugin = plugin
  }

  get currencyInfo (): EdgeCurrencyInfo {
    return this._plugin.currencyInfo
  }

  get userSettings (): Object {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.pluginSettings[this._plugin.pluginName]
  }

  async changeUserSettings (settings: Object): Promise<mixed> {
    await changePluginSettings(
      this._ai,
      this._accountId,
      this._plugin.pluginName,
      settings
    )
  }

  // Deprecated names:
  get settings (): Object {
    return this.userSettings
  }
  get pluginSettings (): Object {
    return this.userSettings
  }
  async changeSettings (settings: Object): Promise<mixed> {
    deprecate('changeSettings', 'changeUserSettings')
    return this.changeUserSettings(settings)
  }
  async changePluginSettings (settings: Object): Promise<mixed> {
    deprecate('changePluginSettings', 'changeUserSettings')
    return this.changeUserSettings(settings)
  }
}

export class SwapConfig extends Bridgeable<EdgeSwapConfig> {
  _ai: ApiInput
  _accountId: string
  _pluginName: string

  constructor (ai: ApiInput, accountId: string, pluginName: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginName = pluginName
  }

  get needsActivation (): boolean {
    const account = this._ai.props.state.accounts[this._accountId]
    return account.swap[this._pluginName].tools.needsActivation
  }

  get swapInfo (): EdgeSwapInfo {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.swap[this._pluginName].plugin.swapInfo
  }

  get userSettings (): Object {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.pluginSettings[this._pluginName]
  }

  async changeUserSettings (settings: Object): Promise<mixed> {
    await changePluginSettings(
      this._ai,
      this._accountId,
      this._pluginName,
      settings
    )
  }

  // Deprecated names:
  get exchangeInfo (): EdgeSwapInfo {
    return this.swapInfo
  }
  get settings (): Object {
    return this.userSettings
  }
  async changeSettings (settings: Object): Promise<mixed> {
    deprecate('changeSettings', 'changeUserSettings')
    return this.changeUserSettings(settings)
  }
}

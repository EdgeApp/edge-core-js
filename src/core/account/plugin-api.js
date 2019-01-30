// @flow

import { Bridgeable, bridgifyObject } from 'yaob'

import {
  type EdgeCurrencyConfig,
  type EdgeCurrencyInfo,
  type EdgeSwapConfig,
  type EdgeSwapInfo
} from '../../types/types.js'
import { type ApiInput } from '../root-pixie.js'
import {
  changePluginUserSettings,
  changeSwapSettings
} from './account-files.js'
import { swapPluginEnabled } from './account-selectors.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyConfig extends Bridgeable<EdgeCurrencyConfig> {
  _ai: ApiInput
  _accountId: string
  _pluginName: string

  otherMethods: Object

  constructor (ai: ApiInput, accountId: string, pluginName: string) {
    super()
    this._ai = ai
    this._accountId = accountId
    this._pluginName = pluginName

    const { otherMethods } = ai.props.state.plugins.currency[pluginName]
    if (otherMethods != null) {
      bridgifyObject(otherMethods)
      this.otherMethods = otherMethods
    } else {
      this.otherMethods = {}
    }
  }

  get currencyInfo (): EdgeCurrencyInfo {
    return this._ai.props.state.plugins.currency[this._pluginName].currencyInfo
  }

  get userSettings (): Object {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.userSettings[this._pluginName]
  }

  async changeUserSettings (settings: Object): Promise<mixed> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginName,
      settings
    )
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

  get enabled (): boolean {
    const account = this._ai.props.state.accounts[this._accountId]
    return swapPluginEnabled(account.swapSettings, this._pluginName)
  }

  get needsActivation (): boolean {
    const plugin = this._ai.props.state.plugins.swap[this._pluginName]
    if (plugin.checkSettings == null) return false

    const selfState = this._ai.props.state.accounts[this._accountId]
    const settings = selfState.userSettings[this._pluginName] || {}
    return !!plugin.checkSettings(settings).needsActivation
  }

  get swapInfo (): EdgeSwapInfo {
    return this._ai.props.state.plugins.swap[this._pluginName].swapInfo
  }

  get userSettings (): Object {
    const selfState = this._ai.props.state.accounts[this._accountId]
    return selfState.userSettings[this._pluginName]
  }

  async changeEnabled (enabled: boolean): Promise<mixed> {
    const account = this._ai.props.state.accounts[this._accountId]
    return changeSwapSettings(this._ai, this._accountId, this._pluginName, {
      ...account.swapSettings[this._pluginName],
      enabled
    })
  }

  async changeUserSettings (settings: Object): Promise<mixed> {
    await changePluginUserSettings(
      this._ai,
      this._accountId,
      this._pluginName,
      settings
    )
  }
}

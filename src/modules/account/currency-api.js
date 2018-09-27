// @flow

import { Bridgeable } from 'yaob'

import {
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  type EdgeExchangeTools
} from '../../index.js'
import type { ApiInput } from '../root.js'
import { changePluginSettings } from './account-files.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyTools extends Bridgeable<EdgeCurrencyTools> {
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

  get settings (): Object {
    return this._ai.props.state.currency.settings[this._plugin.pluginName]
  }

  async changeSettings (settings: Object): Promise<mixed> {
    await changePluginSettings(
      this._ai,
      this._accountId,
      this._plugin,
      settings
    )
  }

  // Deprecated names:
  get pluginSettings (): Object {
    return this.settings
  }
  async changePluginSettings (settings: Object): Promise<mixed> {
    return this.changeSettings(settings)
  }
}

export class ExchangeTools extends Bridgeable<EdgeExchangeTools> {
  _settings: Object

  constructor () {
    super()
    this._settings = {}
  }

  // TODO: Type EdgeExchangeInfo
  get exchangeInfo (): Object {
    return {
      pluginName: 'shapeshift',
      exchangeName: 'ShapeShift',
      homepage: 'https://shapeshift.io/'
    }
  }

  get settings (): Object {
    return this._settings
  }

  async changeSettings (settings: Object): Promise<mixed> {
    this._settings = settings
  }
}

// @flow

import type {
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin
} from '../../edge-core-index.js'
import type { ApiInput } from '../root.js'
import { changePluginSettings } from './account-files.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyTools {
  _ai: ApiInput
  _accountId: string
  _plugin: EdgeCurrencyPlugin

  constructor (ai: ApiInput, accountId: string, plugin: EdgeCurrencyPlugin) {
    this._ai = ai
    this._accountId = accountId
    this._plugin = plugin
  }

  get currencyInfo (): EdgeCurrencyInfo {
    return this._plugin.currencyInfo
  }

  get pluginSettings (): Object {
    return this._ai.props.state.currency.settings[this._plugin.pluginName]
  }

  async changePluginSettings (settings: Object): Promise<mixed> {
    await changePluginSettings(
      this._ai,
      this._accountId,
      this._plugin,
      settings
    )
  }
}

// @flow

import type {
  DiskletFile,
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin
} from '../../edge-core-index.js'
import type { ApiInput } from '../root.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyTools {
  _ai: ApiInput
  _file: DiskletFile
  _plugin: EdgeCurrencyPlugin

  constructor (
    ai: ApiInput,
    plugin: EdgeCurrencyPlugin,
    settingsFile: DiskletFile
  ) {
    this._ai = ai
    this._file = settingsFile
    this._plugin = plugin
  }

  get currencyInfo (): EdgeCurrencyInfo {
    return this._plugin.currencyInfo
  }

  get pluginSettings (): Object {
    return this._ai.props.state.currency.settings[this._plugin.pluginName]
  }

  async changePluginSettings (settings: Object): Promise<mixed> {
    // Actually change the settings on the plugin:
    if (this._plugin.changeSettings) {
      await this._plugin.changeSettings(settings)
    }

    // Update Redux:
    this._ai.props.dispatch({
      type: 'CHANGED_CURRENCY_PLUGIN_SETTING',
      payload: {
        pluginName: this._plugin.pluginName,
        settings
      }
    })

    // Write the new state to disk:
    const json = await getJson(this._file)
    json.pluginSettings = this._ai.props.state.currency.settings
    await this._file.setText(JSON.stringify(json))

    return Promise.resolve()
  }
}

export async function reloadPluginSettings (ai: ApiInput, file: DiskletFile) {
  const json = await getJson(file)

  const goodSettings = {}
  const plugins = ai.props.output.currency.plugins
  if (json.pluginSettings != null && typeof json.pluginSettings === 'object') {
    const allSettings = json.pluginSettings
    for (const pluginName in allSettings) {
      const setting = allSettings[pluginName]
      const plugin = findPlugin(plugins, pluginName)

      if (plugin == null || plugin.changeSettings == null) {
        // If there is no plugin, we just assume the settings are good:
        goodSettings[pluginName] = setting
      } else {
        // Try applying the settings:
        try {
          await plugin.changeSettings(setting)
          goodSettings[pluginName] = setting
        } catch (e) {}
      }
    }
  }

  // Add the final list to Redux:
  ai.props.dispatch({
    type: 'NEW_CURRENCY_PLUGIN_SETTINGS',
    payload: goodSettings
  })
}

function findPlugin (
  plugins: Array<EdgeCurrencyPlugin>,
  pluginName: string
): EdgeCurrencyPlugin | void {
  for (const plugin of plugins) {
    if (plugin.pluginName === pluginName) return plugin
  }
}

function getJson (file: DiskletFile, fallback: Object = {}) {
  return file
    .getText()
    .then(text => JSON.parse(text))
    .catch(e => fallback)
}

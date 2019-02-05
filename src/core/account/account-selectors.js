// @flow

import { type EdgePluginMap } from '../../types/types.js'
import { type SwapSettings } from './account-reducer.js'

/**
 * Determines whether or not a swap plugin is enabled,
 * with various fallbacks in case the settings are missing.
 */
export function swapPluginEnabled (
  swapSettings: EdgePluginMap<SwapSettings>,
  pluginName: string
): boolean {
  const { enabled = true } = swapSettings[pluginName] || {}
  return enabled
}

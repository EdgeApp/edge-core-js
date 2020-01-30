// @flow

import { type SwapSettings } from './account-reducer.js'

/**
 * Determines whether or not a swap plugin is enabled,
 * with various fallbacks in case the settings are missing.
 */
export function swapPluginEnabled(swapSettings: SwapSettings = {}): boolean {
  const { enabled = true } = swapSettings
  return enabled
}

// @flow

import { downgradeDisklet } from 'disklet'
import { type Dispatch } from 'redux'

import {
  type EdgeCorePlugin,
  type EdgeCorePluginFactory,
  type EdgeIo,
  type EdgePluginMap
} from '../../types/types.js'
import { type RootAction } from '../actions.js'
import { changellyPlugin } from '../swap/changelly-plugin.js'
import { changenowPlugin } from '../swap/changenow-plugin'
import { faastPlugin } from '../swap/faast-plugin.js'
import { shapeshiftPlugin } from '../swap/shapeshift-plugin.js'

/**
 * Adds plugins to the context.
 * Designed to run asynchronously in the background.
 */
export async function loadPlugins (
  io: EdgeIo,
  plugins: Array<EdgeCorePluginFactory>,
  dispatch: Dispatch<RootAction>
): Promise<mixed> {
  const payload: EdgePluginMap<EdgeCorePlugin> = {}

  try {
    // Activate the passed-in plugins:
    for (const factory of plugins) {
      if (factory.pluginType === 'currency') {
        const plugin = await factory.makePlugin({
          io: { ...io, folder: downgradeDisklet(io.disklet) }
        })
        payload[plugin.currencyInfo.pluginName] = plugin
      } else if (factory.pluginType === 'exchange') {
        const plugin = await factory.makePlugin({ io })
        payload[plugin.exchangeInfo.exchangeName] = plugin
      }
    }
  } catch (error) {
    dispatch({ type: 'CORE_PLUGINS_FAILED', payload: error })
  }

  // Add the built-in swap plugins:
  payload.changelly = changellyPlugin
  payload.changenow = changenowPlugin
  payload.faast = faastPlugin
  payload.shapeshift = shapeshiftPlugin

  dispatch({ type: 'CORE_PLUGINS_ADDED', payload })
}

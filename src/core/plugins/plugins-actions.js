// @flow

import { navigateDisklet } from 'disklet'
import { type Dispatch } from 'redux'

import {
  type EdgeCorePlugin,
  type EdgeCorePlugins,
  type EdgeCorePluginsInit,
  type EdgeIo,
  type EdgeNativeIo,
  type EdgePluginMap
} from '../../types/types.js'
import { type RootAction } from '../actions.js'

type PluginsAddedWatcher = (plugins: EdgeCorePlugins) => mixed
type PluginsLockedWatcher = () => mixed

const allPlugins: EdgeCorePlugins = {}
let allPluginsLocked: boolean = false
const onPluginsAdded: PluginsAddedWatcher[] = []
const onPluginsLocked: PluginsLockedWatcher[] = []

/**
 * Adds plugins to the core.
 */
export function addEdgeCorePlugins(plugins: EdgeCorePlugins): mixed {
  if (allPluginsLocked) {
    throw new Error('The Edge core plugin list has already been locked')
  }

  // Save the new plugins:
  for (const pluginName in plugins) {
    allPlugins[pluginName] = plugins[pluginName]
  }

  // Update already-booted contexts:
  for (const f of onPluginsAdded) f(plugins)
}

/**
 * Finalizes the core plugin list, so no further plugins are expected.
 */
export function lockEdgeCorePlugins(): mixed {
  allPluginsLocked = true
  for (const f of onPluginsLocked) f()
}

/**
 * Subscribes a context object to the core plugin list.
 */
export function watchPlugins(
  io: EdgeIo,
  nativeIo: EdgeNativeIo,
  pluginsInit: EdgeCorePluginsInit,
  dispatch: Dispatch<RootAction>
): () => mixed {
  const pluginsAdded = plugins => {
    const out: EdgePluginMap<EdgeCorePlugin> = {}

    for (const pluginName in plugins) {
      const plugin = plugins[pluginName]
      const initOptions = pluginsInit[pluginName]
      if (!initOptions) continue

      // Figure out what kind of object this is:
      try {
        if (typeof plugin === 'function') {
          const opts = {
            initOptions: typeof initOptions === 'object' ? initOptions : {},
            io,
            nativeIo,
            pluginDisklet: navigateDisklet(io.disklet, 'plugins/' + pluginName)
          }
          out[pluginName] = plugin(opts)
        } else if (typeof plugin === 'object' && plugin != null) {
          out[pluginName] = plugin
        } else {
          throw new TypeError(
            `Plugins must be functions or objects, got ${typeof plugin}`
          )
        }
      } catch (error) {
        // Show the error but keep going:
        io.console.error(error)
      }
    }

    dispatch({ type: 'CORE_PLUGINS_ADDED', payload: out })
  }

  const pluginsLocked = () => {
    dispatch({ type: 'CORE_PLUGINS_LOCKED', payload: pluginsInit })
  }

  // Add any plugins currently available:
  pluginsAdded(allPlugins)
  if (allPluginsLocked) pluginsLocked()

  // Save the callbacks:
  onPluginsAdded.push(pluginsAdded)
  onPluginsLocked.push(pluginsLocked)

  return () => {
    onPluginsAdded.filter(f => f !== pluginsAdded)
    onPluginsLocked.filter(f => f !== pluginsLocked)
  }
}

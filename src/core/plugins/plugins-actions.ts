import { navigateDisklet } from 'disklet'
import { Dispatch } from 'redux'

import {
  EdgeCorePlugin,
  EdgeCorePluginOptions,
  EdgeCorePlugins,
  EdgeCorePluginsInit,
  EdgeIo,
  EdgeNativeIo,
  EdgePluginMap
} from '../../types/types'
import { RootAction } from '../actions'
import { LogBackend, makeLog } from '../log/log'

export interface PluginIos {
  io: EdgeIo
  nativeIo: EdgeNativeIo
}

type PluginsAddedWatcher = (plugins: EdgeCorePlugins) => void
type PluginsLockedWatcher = () => void

const allPlugins: EdgeCorePlugins = {}
let allPluginsLocked: boolean = false
const onPluginsAdded: PluginsAddedWatcher[] = []
const onPluginsLocked: PluginsLockedWatcher[] = []

/**
 * Adds plugins to the core.
 */
export function addEdgeCorePlugins(plugins: EdgeCorePlugins): void {
  if (allPluginsLocked) {
    throw new Error('The Edge core plugin list has already been locked')
  }

  // Save the new plugins:
  for (const pluginId of Object.keys(plugins)) {
    allPlugins[pluginId] = plugins[pluginId]
  }

  // Update already-booted contexts:
  for (const f of onPluginsAdded) f(plugins)
}

/**
 * Finalizes the core plugin list, so no further plugins are expected.
 */
export function lockEdgeCorePlugins(): void {
  allPluginsLocked = true
  for (const f of onPluginsLocked) f()
}

/**
 * Subscribes a context object to the core plugin list.
 */
export function watchPlugins(
  ios: PluginIos,
  logBackend: LogBackend,
  pluginsInit: EdgeCorePluginsInit,
  dispatch: Dispatch<RootAction>
): () => void {
  const { io, nativeIo } = ios
  const legacyIo = { ...io, console }

  function pluginsAdded(plugins: EdgeCorePlugins): void {
    const out: EdgePluginMap<EdgeCorePlugin> = {}

    for (const pluginId of Object.keys(plugins)) {
      const plugin = plugins[pluginId]
      const log = makeLog(logBackend, pluginId)
      const initOptions = pluginsInit[pluginId]
      if (initOptions === false || initOptions == null) continue

      // Figure out what kind of object this is:
      try {
        if (typeof plugin === 'function') {
          const opts: EdgeCorePluginOptions = {
            initOptions: typeof initOptions === 'object' ? initOptions : {},
            io: legacyIo,
            log,
            nativeIo,
            pluginDisklet: navigateDisklet(io.disklet, 'plugins/' + pluginId)
          }
          out[pluginId] = plugin(opts)
        } else if (typeof plugin === 'object' && plugin != null) {
          out[pluginId] = plugin
        } else {
          throw new TypeError(
            `Plugins must be functions or objects, got ${typeof plugin}`
          )
        }
      } catch (error: unknown) {
        // Show the error but keep going:
        log.error(error)
      }
    }

    dispatch({ type: 'CORE_PLUGINS_ADDED', payload: out })
  }

  function pluginsLocked(): void {
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

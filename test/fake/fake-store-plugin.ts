import {
  EdgeCorePluginOptions,
  EdgeSwapPlugin,
  EdgeSwapQuote
} from '../../src/index'

/**
 * Plugins that exist only to be handed a plugin database.
 *
 * The fake currency plugins are registered as objects, so they never receive
 * the options a factory gets. These are factories, and they keep what they
 * were handed, per context, so a test can reach the store the core built.
 */
export const fakeStorePluginOptions: {
  [pluginId: string]: EdgeCorePluginOptions[]
} = {}

function makeFakeStorePlugin(pluginId: string) {
  return (opts: EdgeCorePluginOptions): EdgeSwapPlugin => {
    const list = fakeStorePluginOptions[pluginId] ?? []
    list.push(opts)
    fakeStorePluginOptions[pluginId] = list
    return {
      swapInfo: {
        displayName: pluginId,
        pluginId,
        supportEmail: ''
      },
      async fetchSwapQuote(): Promise<EdgeSwapQuote> {
        throw new Error('Not a real swap plugin')
      }
    }
  }
}

/** Two ids where one is a prefix of the other. */
export const fakeStorePlugins = {
  storeplug: makeFakeStorePlugin('storeplug'),
  storeplugin: makeFakeStorePlugin('storeplugin')
}

/** The options the most recent context handed a store plugin. */
export function lastStoreOptions(pluginId: string): EdgeCorePluginOptions {
  const list = fakeStorePluginOptions[pluginId] ?? []
  const last = list[list.length - 1]
  if (last == null) throw new Error(`${pluginId} was never created`)
  return last
}

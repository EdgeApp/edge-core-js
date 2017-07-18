import { setPlugins } from './reducer.js'

export function setupPlugins (io, plugins) {
  const currencyPromises = []
  const exchangePromises = []

  for (const plugin of plugins) {
    switch (plugin.pluginType) {
      case 'currency':
        currencyPromises.push(plugin.makePlugin(io))
        break
      case 'exchange':
        exchangePromises.push(plugin.makePlugin(io))
        break
      default:
        throw new Error(`Unknown plugin type ${plugin.pluginType}`)
    }
  }

  return dispatch =>
    Promise.all([
      Promise.all(currencyPromises),
      Promise.all(exchangePromises)
    ]).then(([currencyPlugins, exchangePlugins]) => {
      // Fix legacy plugins:
      for (const plugin of currencyPlugins) {
        if (plugin.currencyInfo == null) {
          plugin.currencyInfo = plugin.getInfo()
        }
      }

      return dispatch(setPlugins(currencyPlugins, exchangePlugins))
    })
}

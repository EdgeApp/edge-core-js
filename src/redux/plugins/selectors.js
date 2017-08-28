export function getCurrencyPlugins (state) {
  return state.plugins.currencyPlugins
}

export function getCurrencyPlugin (state, walletType) {
  const plugins = getCurrencyPlugins(state)

  for (const plugin of plugins) {
    const currencyInfo = plugin.currencyInfo || plugin.getInfo()
    for (const type of currencyInfo.walletTypes) {
      if (type === walletType) {
        return plugin
      }
    }
  }

  throw new Error(`Cannot find a currency plugin for wallet type ${walletType}`)
}

export function getCurrencyMultiplier (state, currencyCode) {
  for (const plugin of state.plugins.currencyPlugins) {
    const info = plugin.currencyInfo

    for (const denomination of info.denominations) {
      if (denomination.name === currencyCode) {
        return denomination.multiplier
      }
    }

    for (const token of info.metaTokens) {
      for (const denomination of token.denominations) {
        if (denomination.name === currencyCode) {
          return denomination.multiplier
        }
      }
    }
  }

  return 1
}

export function getExchangePlugins (state) {
  return state.plugins.exchangePlugins
}

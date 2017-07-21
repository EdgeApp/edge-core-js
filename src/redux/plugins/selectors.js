export function getCurrencyPlugins (state) {
  return state.plugins.currencyPlugins
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

// @flow

import { gt, lt } from 'biggystring'
import { bridgifyObject } from 'yaob'

import {
  type EdgeSwapCurrencies,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuote,
  type EdgeSwapQuoteOptions,
  errorNames
} from '../../index.js'
import { fuzzyTimeout } from '../../util/promise.js'
import { swapPluginEnabled } from '../account/account-selectors.js'
import { type ApiInput } from '../root.js'

/**
 * Fetch supported currencies from all plugins.
 */
export async function fetchSwapCurrencies (
  ai: ApiInput,
  accountId: string
): Promise<EdgeSwapCurrencies> {
  const { swapSettings, swapTools } = ai.props.state.accounts[accountId]

  type Result = { currencies: Array<string>, pluginName: string }
  const promises: Array<Promise<Result>> = []
  for (const n in swapTools) {
    if (swapPluginEnabled(swapSettings, n)) {
      promises.push(
        swapTools[n]
          .fetchCurrencies()
          .then(
            currencies => ({ currencies, pluginName: n }),
            e => ({ currencies: [], pluginName: n })
          )
      )
    }
  }
  const results = await Promise.all(promises)

  const out: EdgeSwapCurrencies = {}
  for (const { currencies, pluginName } of results) {
    for (const cc of currencies) {
      if (out[cc] == null) {
        const pluginNames = []
        out[cc] = { pluginNames, exchanges: pluginNames }
      }
      out[cc].pluginNames.push(pluginName)
    }
  }

  ai.props.dispatch({
    type: 'ACCOUNT_SWAP_CURRENCIES_FETCHED',
    payload: { accountId, currencies: out }
  })

  return out
}

/**
 * Fetch quotes from all plugins, and pick the best one.
 */
export async function fetchSwapQuote (
  ai: ApiInput,
  accountId: string,
  opts: EdgeSwapQuoteOptions
): Promise<EdgeSwapQuote> {
  const account = ai.props.state.accounts[accountId]
  const { swapCurrencies, swapPlugins, swapSettings, swapTools } = account

  const promises: Array<Promise<EdgeSwapPluginQuote>> = []
  for (const n in swapTools) {
    if (
      swapPluginEnabled(swapSettings, n) &&
      !swapTools[n].needsActivation &&
      canSwap(n, swapCurrencies, opts)
    ) {
      promises.push(swapTools[n].fetchQuote(opts))
    }
  }

  return fuzzyTimeout(promises, 20000).then(
    quotes => {
      if (quotes.length < 1) throw new Error('No swap providers enabled')

      // Find the cheapest price:
      let bestQuote = quotes[0]
      for (let i = 1; i < quotes.length; ++i) {
        if (
          gt(quotes[i].toNativeAmount, bestQuote.toNativeAmount) ||
          lt(quotes[i].fromNativeAmount, bestQuote.fromNativeAmount)
        ) {
          bestQuote = quotes[i]
        }
      }

      // Cobble together a URI:
      const swapInfo = swapPlugins[bestQuote.pluginName].swapInfo
      let quoteUri
      if (bestQuote.quoteId != null && swapInfo.quoteUri != null) {
        quoteUri = swapInfo.quoteUri + bestQuote.quoteId
      }

      const out: EdgeSwapQuote = {
        ...bestQuote,
        quoteUri,
        exchangeService: bestQuote.pluginName // Deprecated
      }
      bridgifyObject(out)

      return out
    },
    errors => {
      if (errors.length < 1) throw new Error('No swap providers enabled')

      let bestError = errors[0]
      for (let i = 1; i < errors.length; ++i) {
        if (betterError(errors[i], bestError)) bestError = errors[i]
      }
      throw bestError
    }
  )
}

/**
 * Returns true if error a is better than error b.
 */
function betterError (a: Object, b: Object) {
  if (a.name === errorNames.SwapBelowLimitError) {
    if (b.name !== errorNames.SwapBelowLimitError) return true
    return lt(a.nativeMin, b.nativeMin)
  }
  if (a.name === errorNames.SwapAboveLimitError) {
    if (b.name !== errorNames.SwapAboveLimitError) return true
    return gt(a.nativeMax, b.nativeMax)
  }
  return (
    a.name === errorNames.InsufficientFundsError ||
    a.name === errorNames.PendingFundsError
  )
}

/**
 * Returns true if a pluginName handles both the input & output coins.
 */
function canSwap (
  pluginName: string,
  currencies: EdgeSwapCurrencies,
  opts: EdgeSwapQuoteOptions
): boolean {
  const { fromCurrencyCode, toCurrencyCode } = opts

  const fromPlugins = currencies[fromCurrencyCode]
  if (fromPlugins == null || fromPlugins.pluginNames.indexOf(pluginName) < 0) {
    return false
  }

  const toPlugins = currencies[toCurrencyCode]
  if (toPlugins == null || toPlugins.pluginNames.indexOf(pluginName) < 0) {
    return false
  }

  return true
}

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
import { type ApiInput } from '../root.js'

/**
 * Splits an object into an array of keys and an array of values.
 */
function splitObject<Type> (object: {
  [key: string]: Type
}): [Array<string>, Array<Type>] {
  const keys = []
  const values = []
  for (const key in object) {
    keys.push(key)
    values.push(object[key])
  }

  return [keys, values]
}

/**
 * Fetch supported currencies from all plugins.
 */
export async function fetchSwapCurrencies (
  ai: ApiInput,
  accountId: string
): Promise<EdgeSwapCurrencies> {
  const selfState = ai.props.state.accounts[accountId]
  const [allPluginNames, states] = splitObject(selfState.swap)
  const arrays: Array<Array<string>> = await Promise.all(
    states.map(state => state.tools.fetchCurrencies())
  )

  const out: EdgeSwapCurrencies = {}
  for (let i = 0; i < arrays.length; ++i) {
    for (const cc of arrays[i]) {
      if (out[cc] == null) {
        const pluginNames = []
        out[cc] = { pluginNames, exchanges: pluginNames }
      }
      out[cc].pluginNames.push(allPluginNames[i])
    }
  }
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
  const swapState = ai.props.state.accounts[accountId].swap

  const promises: Array<Promise<EdgeSwapPluginQuote>> = []
  for (const n in swapState) {
    if (!swapState[n].tools.needsActivation) {
      promises.push(swapState[n].tools.fetchQuote(opts))
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
      const swapInfo = swapState[bestQuote.pluginName].plugin.swapInfo
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
  return false
}

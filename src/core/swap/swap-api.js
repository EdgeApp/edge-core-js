// @flow

import { gt, lt } from 'biggystring'
import { bridgifyObject } from 'yaob'

import {
  type EdgeSwapCurrencies,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuote,
  type EdgeSwapQuoteOptions,
  errorNames
} from '../../types/types.js'
import { fuzzyTimeout } from '../../util/promise.js'
import { swapPluginEnabled } from '../account/account-selectors.js'
import { type ApiInput } from '../root-pixie.js'

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
        swapTools[n].fetchCurrencies().then(
          currencies => ({ currencies, pluginName: n }),
          e => {
            ai.props.io.console.info(e)
            return { currencies: [], pluginName: n }
          }
        )
      )
    }
  }
  const results = await Promise.all(promises)

  const out: EdgeSwapCurrencies = {}
  for (const { currencies, pluginName } of results) {
    for (const cc of currencies) {
      if (out[cc] == null) out[cc] = { pluginNames: [] }
      out[cc].pluginNames.push(pluginName)
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
  const account = ai.props.state.accounts[accountId]
  const { swapSettings, swapTools } = account

  const promises: Array<Promise<EdgeSwapPluginQuote>> = []
  for (const n in swapTools) {
    if (swapPluginEnabled(swapSettings, n)) {
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
      const { swapInfo } = ai.props.state.plugins.swap[bestQuote.pluginName]
      let quoteUri
      if (bestQuote.quoteId != null && swapInfo.quoteUri != null) {
        quoteUri = swapInfo.quoteUri + bestQuote.quoteId
      }

      const out: EdgeSwapQuote = { ...bestQuote, quoteUri }
      bridgifyObject(out)

      return out
    },
    errors => {
      if (errors.length < 1) throw new Error('No swap providers enabled')

      let bestError = errors[0]
      for (let i = 1; i < errors.length; ++i) {
        bestError = pickError(bestError, errors[i])
      }
      throw bestError
    }
  )
}

/**
 * Ranks different error codes by priority.
 */
function rankError (error: Object) {
  if (error.name === errorNames.SwapBelowLimitError) return 5
  if (error.name === errorNames.SwapAboveLimitError) return 4
  if (error.name === errorNames.InsufficientFundsError) return 3
  if (error.name === errorNames.PendingFundsError) return 3
  if (error.name === errorNames.SwapPermissionError) return 2
  if (error.name === errorNames.SwapCurrencyError) return 1
  return 0
}

/**
 * Picks the best error out of two choices.
 */
function pickError (a: Object, b: Object): Object {
  // Return the highest-ranked error:
  const diff = rankError(a) - rankError(b)
  if (diff > 0) return a
  if (diff < 0) return b

  // Same ranking, so use amounts to distinguish:
  if (a.name === errorNames.SwapBelowLimitError) {
    return lt(a.nativeMin, b.nativeMin) ? a : b
  }
  if (a.name === errorNames.SwapAboveLimitError) {
    return gt(a.nativeMax, b.nativeMax) ? a : b
  }

  // Otherwise, just pick one:
  return a
}

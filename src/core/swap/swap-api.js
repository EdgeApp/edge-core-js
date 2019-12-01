// @flow

import { div, gt, lt } from 'biggystring'
import { bridgifyObject } from 'yaob'

import {
  type EdgeSwapPluginQuote,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  errorNames
} from '../../types/types.js'
import { fuzzyTimeout } from '../../util/promise.js'
import { swapPluginEnabled } from '../account/account-selectors.js'
import { type ApiInput } from '../root-pixie.js'

/**
 * Fetch quotes from all plugins, and pick the best one.
 */
export async function fetchSwapQuote(
  ai: ApiInput,
  accountId: string,
  request: EdgeSwapRequest
): Promise<EdgeSwapQuote> {
  const { io } = ai.props

  const account = ai.props.state.accounts[accountId]
  const { swapSettings, userSettings } = account
  const swapPlugins = ai.props.state.plugins.swap

  const promises: Promise<EdgeSwapPluginQuote>[] = []
  for (const n in swapPlugins) {
    if (swapPluginEnabled(swapSettings, n)) {
      promises.push(swapPlugins[n].fetchSwapQuote(request, userSettings[n]))
    }
  }

  return fuzzyTimeout(promises, 20000).then(
    quotes => {
      if (quotes.length < 1) throw new Error('No swap providers enabled')
      io.console.info(
        `${promises.length} swap quotes requested, ${
          quotes.length
        } resolved: ${JSON.stringify(quotes, null, 2)}`
      )

      // Find the cheapest price:
      const bestQuote = quotes.reduce(pickQuote)

      // Close unused quotes:
      for (const quote of quotes) {
        if (quote !== bestQuote) quote.close()
      }

      // Cobble together a URI:
      const { swapInfo } = swapPlugins[bestQuote.pluginName]
      let quoteUri
      if (bestQuote.quoteId != null && swapInfo.quoteUri != null) {
        quoteUri = swapInfo.quoteUri + bestQuote.quoteId
      }

      const { isEstimate = true } = bestQuote
      // $FlowFixMe - Flow wrongly thinks isEstimate might be undefined here:
      const out: EdgeSwapQuote = { ...bestQuote, quoteUri, isEstimate }
      bridgifyObject(out)

      return out
    },
    errors => {
      if (errors.length < 1) throw new Error('No swap providers enabled')
      io.console.info(
        `All ${promises.length} swap quotes rejected: ${JSON.stringify(
          errors.map(error => {
            const { name, message } = error
            return { name, message, ...error }
          }),
          null,
          2
        )}`
      )

      let bestError = errors[0]
      for (let i = 1; i < errors.length; ++i) {
        bestError = pickError(bestError, errors[i])
      }
      throw bestError
    }
  )
}

/**
 * Picks the best quote out of two choices.
 */
function pickQuote(
  a: EdgeSwapPluginQuote,
  b: EdgeSwapPluginQuote
): EdgeSwapPluginQuote {
  const { isEstimate: aIsEstimate = true } = a
  const { isEstimate: bIsEstimate = true } = b

  // Prioritize accurate quotes over estimates:
  if (aIsEstimate && !bIsEstimate) return b
  if (!aIsEstimate && bIsEstimate) return a

  // Prefer cheaper quotes:
  return gt(
    div(b.toNativeAmount, b.fromNativeAmount),
    div(a.toNativeAmount, a.fromNativeAmount)
  )
    ? b
    : a
}

/**
 * Ranks different error codes by priority.
 */
function rankError(error: Object) {
  if (error.name === errorNames.InsufficientFundsError) return 5
  if (error.name === errorNames.PendingFundsError) return 5
  if (error.name === errorNames.SwapBelowLimitError) return 4
  if (error.name === errorNames.SwapAboveLimitError) return 3
  if (error.name === errorNames.SwapPermissionError) return 2
  if (error.name === errorNames.SwapCurrencyError) return 1
  return 0
}

/**
 * Picks the best error out of two choices.
 */
function pickError(a: Object, b: Object): Object {
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

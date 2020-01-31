// @flow

import { div, gt, lt } from 'biggystring'
import { bridgifyObject } from 'yaob'

import {
  type EdgePluginMap,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapRequestOptions,
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
  request: EdgeSwapRequest,
  opts?: EdgeSwapRequestOptions
): Promise<EdgeSwapQuote> {
  const { log } = ai.props

  const account = ai.props.state.accounts[accountId]
  const { swapSettings, userSettings } = account
  const swapPlugins = ai.props.state.plugins.swap

  // Invoke all the active swap plugins:
  const promises = Object.keys(swapPlugins)
    .filter(pluginId => swapPluginEnabled(swapSettings[pluginId]))
    .map(pluginId =>
      swapPlugins[pluginId].fetchSwapQuote(request, userSettings[pluginId])
    )
  if (promises.length < 1) throw new Error('No swap providers enabled')

  // Wait for the results, with error handling:
  return fuzzyTimeout(promises, 20000).then(
    quotes => {
      log(
        `${promises.length} swap quotes requested, ${quotes.length} resolved:`,
        ...quotes
      )

      // Find the cheapest price:
      const bestQuote = pickBestQuote(quotes, opts)

      // Close unused quotes:
      for (const quote of quotes) {
        if (quote !== bestQuote) quote.close().catch(() => undefined)
      }
      return bridgifyObject(upgradeQuote(bestQuote, swapPlugins))
    },
    errors => {
      log(
        `All ${promises.length} swap quotes rejected:`,
        ...errors.map(error => {
          const { name, message } = error
          return { name, message, ...error }
        })
      )

      throw pickBestError(errors)
    }
  )
}

/**
 * Picks the best quote out of the available choices.
 */
function pickBestQuote(
  quotes: EdgeSwapPluginQuote[],
  opts: EdgeSwapRequestOptions = {}
): EdgeSwapPluginQuote {
  const { preferPluginId } = opts

  return quotes.reduce((a, b) => {
    // Always return quotes from the preferred provider:
    if (a.pluginName === preferPluginId) return a
    if (b.pluginName === preferPluginId) return b

    // Prioritize accurate quotes over estimates:
    const { isEstimate: aIsEstimate = true } = a
    const { isEstimate: bIsEstimate = true } = b
    if (aIsEstimate && !bIsEstimate) return b
    if (!aIsEstimate && bIsEstimate) return a

    // Prefer the best rate:
    const aRate = div(a.toNativeAmount, a.fromNativeAmount)
    const bRate = div(b.toNativeAmount, b.fromNativeAmount)
    return gt(bRate, aRate) ? b : a
  })
}

/**
 * Picks the best error out of the available choices.
 */
function pickBestError(errors: any[]): any {
  return errors.reduce((a, b) => {
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
  })
}

/**
 * Ranks different error codes by priority.
 */
function rankError(error: any) {
  if (error.name === errorNames.InsufficientFundsError) return 5
  if (error.name === errorNames.PendingFundsError) return 5
  if (error.name === errorNames.SwapBelowLimitError) return 4
  if (error.name === errorNames.SwapAboveLimitError) return 3
  if (error.name === errorNames.SwapPermissionError) return 2
  if (error.name === errorNames.SwapCurrencyError) return 1
  return 0
}

/**
 * Turns a raw quote from the plugins into something the GUI expects.
 */
function upgradeQuote(
  quote: EdgeSwapPluginQuote,
  swapPlugins: EdgePluginMap<EdgeSwapPlugin>
): EdgeSwapQuote {
  const { isEstimate = true, pluginId = quote.pluginName } = quote
  const { swapInfo } = swapPlugins[pluginId]

  // Cobble together a URI:
  let quoteUri
  if (quote.quoteId != null && swapInfo.quoteUri != null) {
    quoteUri = swapInfo.quoteUri + quote.quoteId
  }

  // $FlowFixMe - Flow wrongly thinks isEstimate might be undefined here:
  return { ...quote, isEstimate, pluginId, quoteUri }
}

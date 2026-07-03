import { gt, lt } from 'biggystring'
import { bridgifyObject, close } from 'yaob'

import { upgradeSwapQuote } from '../../types/type-helpers'
import {
  asMaybeInsufficientFundsError,
  asMaybePendingFundsError,
  asMaybeSwapAboveLimitError,
  asMaybeSwapAddressError,
  asMaybeSwapBelowLimitError,
  asMaybeSwapCurrencyError,
  asMaybeSwapPermissionError,
  EdgePluginMap,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapRequestOptions,
  EdgeSwapToAddressInfo
} from '../../types/types'
import { fuzzyTimeout, timeout } from '../../util/promise'
import { CurrencyConfig } from '../account/plugin-api'
import { ApiInput } from '../root-pixie'
import { makeSyntheticDestinationWallet } from './synthetic-wallet'

/**
 * Fetch quotes from all plugins, and sorts the best ones to the front.
 */
export async function fetchSwapQuotes(
  ai: ApiInput,
  accountId: string,
  request: EdgeSwapRequest,
  opts: EdgeSwapRequestOptions = {}
): Promise<EdgeSwapQuote[]> {
  const {
    disabled = {},
    noResponseMs,
    preferPluginId,
    promoCodes = {},
    slowResponseMs = 20000
  } = opts
  const { log, state } = ai.props

  const account = state.accounts[accountId]
  const { swapSettings, userSettings } = account
  const swapPlugins = state.plugins.swap

  // Resolve the destination. A normal swap provides `toWallet`; a
  // swap-to-address (private send) request provides `toAddressInfo` instead, and
  // the core builds a synthetic destination wallet from it so plugins receive an
  // `EdgeCurrencyWallet` unchanged.
  const swapRequest = resolveSwapRequest(ai, accountId, request)

  log.warn(
    'Requesting swap quotes for: ',
    {
      ...swapRequest,
      fromWallet: swapRequest.fromWallet.id,
      toWallet: swapRequest.toWallet?.id,
      // Never log the pasted destination address or its memos
      // (private-send privacy):
      toAddressInfo:
        swapRequest.toAddressInfo == null
          ? undefined
          : redactToAddressInfo(swapRequest.toAddressInfo)
    },
    { preferPluginId, promoCodes }
  )

  // Invoke all the active swap plugins:
  const pendingIds = new Set<string>()
  const promises: Array<Promise<EdgeSwapQuote>> = []
  for (const pluginId of Object.keys(swapPlugins)) {
    const { enabled = true } =
      swapSettings[pluginId] != null ? swapSettings[pluginId] : {}
    if (!enabled || disabled[pluginId]) continue

    // Start request:
    pendingIds.add(pluginId)
    promises.push(
      swapPlugins[pluginId]
        .fetchSwapQuote(swapRequest, userSettings[pluginId], {
          infoPayload: state.infoCache.corePlugins?.[pluginId] ?? {},
          promoCode: promoCodes[pluginId]
        })
        .then(
          quote => {
            upgradeSwapQuote(quote)
            const { fromWallet, toWallet, toAddressInfo, ...rest } =
              quote.request ?? {}
            // Never log the pasted destination address or its memos
            // (private-send privacy):
            const request =
              toAddressInfo == null
                ? rest
                : {
                    ...rest,
                    toAddressInfo: redactToAddressInfo(toAddressInfo)
                  }
            const cleaned = { ...quote, request }
            pendingIds.delete(pluginId)
            log.warn(`${pluginId} gave swap quote:`, cleaned)
            return quote
          },
          error => {
            pendingIds.delete(pluginId)
            log.warn(`${pluginId} gave swap error: ${String(error)}`)
            // Log unknown errors:
            if (isUnknownSwapError(error)) {
              log.crash(`Unknown swap error: ${String(error)}`, {
                error,
                swapPluginId: pluginId,
                request: {
                  // Stringify to include "null"
                  fromToken: String(swapRequest.fromTokenId),
                  fromWalletType: swapRequest.fromWallet.type,
                  // Stringify to include "null"
                  toToken: String(swapRequest.toTokenId),
                  toWalletType: swapRequest.toWallet?.type,
                  quoteFor: swapRequest.quoteFor
                }
              })
            }
            throw error
          }
        )
    )
  }

  // Wait for the results, with error handling:
  const promise = fuzzyTimeout(promises, slowResponseMs).then(
    ({ results: quotes, errors }) => {
      for (const pluginId of pendingIds) {
        log.warn(`${pluginId} gave swap timeout`)
      }

      // Find the cheapest price:
      const sorted = sortQuotes(quotes, opts)
      log.warn(
        `${promises.length} swap quotes requested, ${quotes.length} resolved, ${
          errors.length
        } failed, sorted ${sorted.map(quote => quote.pluginId).join(', ')}.`
      )

      // Prepare quotes for the bridge:
      return quotes.map(quote => wrapQuote(swapPlugins, swapRequest, quote))
    },
    (errors: unknown[]) => {
      log.warn(`All ${promises.length} swap quotes rejected.`)
      throw pickBestError(errors)
    }
  )

  if (noResponseMs == null) return await promise
  return await timeout(promise, noResponseMs)
}

/**
 * Strips the private pieces (destination address and memos) out of a
 * `toAddressInfo` descriptor so it can be logged.
 */
function redactToAddressInfo(
  toAddressInfo: EdgeSwapToAddressInfo
): EdgeSwapToAddressInfo {
  const { toMemos } = toAddressInfo
  return {
    ...toAddressInfo,
    toAddress: '[redacted]',
    toMemos:
      toMemos == null
        ? undefined
        : toMemos.map(memo => ({ ...memo, value: '[redacted]' }))
  }
}

/**
 * Validates the destination on a swap request and resolves it to a request that
 * always carries a `toWallet`. Exactly one of `toWallet` or `toAddressInfo` must
 * be present; when it is `toAddressInfo`, a synthetic destination wallet is built
 * core-side from the descriptor.
 */
function resolveSwapRequest(
  ai: ApiInput,
  accountId: string,
  request: EdgeSwapRequest
): EdgeSwapRequest {
  const { toWallet, toAddressInfo } = request

  if ((toWallet == null) === (toAddressInfo == null)) {
    throw new Error(
      'Swap request must include exactly one of `toWallet` or `toAddressInfo`'
    )
  }
  if (toAddressInfo == null) return request

  const { toPluginId, toAddress, toMemos } = toAddressInfo
  const { toTokenId } = request
  if (ai.props.state.plugins.currency[toPluginId] == null) {
    throw new Error(
      `Cannot build swap destination: no currency plugin "${toPluginId}"`
    )
  }
  const currencyConfig = new CurrencyConfig(ai, accountId, toPluginId)
  if (toTokenId != null && currencyConfig.allTokens[toTokenId] == null) {
    throw new Error(
      `Cannot build swap destination: no token "${toTokenId}" on plugin "${toPluginId}"`
    )
  }

  // Drop the descriptor from the resolved request so it keeps exactly one
  // destination: a resolved request that rides back to the caller inside
  // `quote.request` must be re-submittable without tripping the
  // exactly-one-of rule above.
  return {
    ...request,
    toAddressInfo: undefined,
    toWallet: makeSyntheticDestinationWallet(currencyConfig, toAddress, toMemos)
  }
}

function wrapQuote(
  swapPlugins: EdgePluginMap<EdgeSwapPlugin>,
  request: EdgeSwapRequest,
  quote: EdgeSwapQuote
): EdgeSwapQuote {
  const out = bridgifyObject<EdgeSwapQuote>({
    canBePartial: quote.canBePartial,
    expirationDate: quote.expirationDate,
    fromNativeAmount: quote.fromNativeAmount,
    isEstimate: quote.isEstimate,
    maxFulfillmentSeconds: quote.maxFulfillmentSeconds,
    networkFee: quote.networkFee,
    pluginId: quote.pluginId,
    request: quote.request ?? request,
    swapInfo: quote.swapInfo ?? swapPlugins[quote.pluginId].swapInfo,
    toNativeAmount: quote.toNativeAmount,
    minReceiveAmount: quote.minReceiveAmount,

    async approve(opts) {
      return await quote.approve(opts)
    },

    async close() {
      await quote.close()
      close(out)
    }
  })
  return out
}

/**
 * Sorts the best quotes first.
 */
export function sortQuotes(
  quotes: EdgeSwapQuote[],
  opts: EdgeSwapRequestOptions
): EdgeSwapQuote[] {
  const { preferPluginId, preferType, promoCodes } = opts
  return quotes.sort((a, b) => {
    // Prioritize transfer plugin:
    if (a.pluginId === 'transfer') return -1
    if (b.pluginId === 'transfer') return 1

    // Always return quotes from the preferred provider:
    if (a.pluginId === preferPluginId) return -1
    if (b.pluginId === preferPluginId) return 1

    // Prefer based on plugin but always allow `transfer` plugins:
    if (preferType != null) {
      const aMatchesType =
        (a.swapInfo.isDex === true && preferType === 'DEX') ||
        (a.swapInfo.isDex !== true && preferType === 'CEX')
      const bMatchesType =
        (b.swapInfo.isDex === true && preferType === 'DEX') ||
        (b.swapInfo.isDex !== true && preferType === 'CEX')
      if (aMatchesType && !bMatchesType) return -1
      if (!aMatchesType && bMatchesType) return 1
    }

    // Prioritize providers with active promo codes:
    if (promoCodes != null) {
      const aHasPromo = promoCodes[a.pluginId] != null
      const bHasPromo = promoCodes[b.pluginId] != null
      if (aHasPromo && !bHasPromo) return -1
      if (!aHasPromo && bHasPromo) return 1
    }

    // Prioritize accurate quotes over estimates:
    const { isEstimate: aIsEstimate = true } = a
    const { isEstimate: bIsEstimate = true } = b
    if (!aIsEstimate && bIsEstimate) return -1
    if (aIsEstimate && !bIsEstimate) return 1

    // Prefer the best rate:
    const aRate = Number(a.toNativeAmount) / Number(a.fromNativeAmount)
    const bRate = Number(b.toNativeAmount) / Number(b.fromNativeAmount)
    if (aRate > bRate) return -1
    if (bRate > aRate) return 1
    return 0
  })
}

/**
 * Picks the best error out of the available choices.
 */
function pickBestError(errors: unknown[]): unknown {
  return errors.reduce((a, b) => {
    // Return the highest-ranked error:
    const diff = rankError(a) - rankError(b)
    if (diff > 0) return a
    if (diff < 0) return b

    // Same ranking, so use amounts to distinguish:
    const aBelow = asMaybeSwapBelowLimitError(a)
    const bBelow = asMaybeSwapBelowLimitError(b)
    if (aBelow != null && bBelow != null) {
      return lt(aBelow.nativeMin, bBelow.nativeMin) ? aBelow : bBelow
    }
    const aAbove = asMaybeSwapAboveLimitError(a)
    const bAbove = asMaybeSwapAboveLimitError(b)
    if (aAbove != null && bAbove != null) {
      return gt(aAbove.nativeMax, bAbove.nativeMax) ? aAbove : bAbove
    }

    // Otherwise, just pick one:
    return a
  })
}

/**
 * Ranks different error codes by priority.
 */
function rankError(error: unknown): number {
  if (error == null) return 0
  if (asMaybeInsufficientFundsError(error) != null) return 6
  if (asMaybePendingFundsError(error) != null) return 6
  if (asMaybeSwapBelowLimitError(error) != null) return 5
  if (asMaybeSwapAboveLimitError(error) != null) return 4
  if (asMaybeSwapAddressError(error) != null) return 3.5
  if (asMaybeSwapPermissionError(error) != null) return 3
  if (asMaybeSwapCurrencyError(error) != null) return 2
  return 1
}

function isUnknownSwapError(error: unknown): boolean {
  const isKnownError = rankError(error) > 1
  // NOTE: Add more error filtering here as we decide to filter out noise.
  return !isKnownError
}

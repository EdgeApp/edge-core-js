// @flow

import { wrapObject } from '../../util/api.js'
import { getExchangeRate } from '../exchange/exchange-selectors.js'
import type { ApiInput } from '../root.js'

/**
 * Creates an `ExchangeCache` API object.
 */
export function makeExchangeCache (ai: ApiInput) {
  return wrapObject('ExchangeCache', makeExchangeCacheApi(ai))
}

/**
 * Creates an unwrapped exchange cache API object.
 */
function makeExchangeCacheApi (ai: ApiInput) {
  /**
   * TODO: Once the user has an exchange-rate preference,
   * look that up and bias in favor of the preferred exchange.
   */
  function getPairCost (source, age, inverse) {
    // The age curve goes from 0 to 1, with 1 being infinitely old.
    // The curve reaches half way (0.5) at 30 seconds in:
    const ageCurve = age / (30 + age)

    return ageCurve + (inverse ? 1.1 : 1) // + 2 * isWrongExchange()
  }

  const out = {
    '@convertCurrency': { sync: true },
    convertCurrency (fromCurrency, toCurrency, amount = 1) {
      const rate = getExchangeRate(
        ai.props.state,
        fromCurrency,
        toCurrency,
        getPairCost
      )
      return amount * rate
    }
  }

  return out
}

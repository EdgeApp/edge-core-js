// @flow
import type { CoreRoot } from '../coreRoot.js'
import { wrapObject } from '../util/api.js'
import { getExchangeRate } from '../redux/selectors.js'

/**
 * Creates an `ExchangeCache` API object.
 */
export function makeExchangeCache (coreRoot: CoreRoot) {
  const { redux } = coreRoot

  return wrapObject(
    coreRoot.onError,
    'ExchangeCache',
    makeExchangeCacheApi(redux.dispatch, redux.getState)
  )
}

/**
 * Creates an unwrapped exchange cache API object.
 */
function makeExchangeCacheApi (dispatch, getState) {
  /**
   * TODO: Once the user has an exchange-rate preference,
   * look that up and bias in favor of the preferred exchange.
   */
  function getPairCost (source, age, inverse) {
    // The age curve goes from 0 to 1, with 1 being infinitely old.
    // The curve reaches half way (0.5) at 30 seconds in:
    const ageCurve = age / (30 + age)

    return 1 + 0.1 * inverse + ageCurve // + 2 * isWrongExchange()
  }

  const out = {
    '@convertCurrency': { sync: true },
    convertCurrency (fromCurrency, toCurrency, amount = 1) {
      const rate = getExchangeRate(
        getState(),
        fromCurrency,
        toCurrency,
        getPairCost
      )
      return amount * rate
    }
  }

  return out
}

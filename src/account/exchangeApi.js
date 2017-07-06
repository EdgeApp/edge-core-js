import { wrapObject } from '../util/api.js'
import { getExchangeRate } from '../redux/selectors.js'

/**
 * Creates an `ExchangeCache` API object.
 */
export function makeExchangeCache (io) {
  const { redux } = io

  return wrapObject(
    io.onError,
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
  function scorePair (pair, inverse, now) {
    // The age curve goes from 0 to 1, with 1 being infinitely old.
    // The curve reaches half way (0.5) at 30 seconds in:
    const age = Math.abs(now - pair.timestamp)
    const ageCurve = age / (30 + age)

    return 1 + 0.1 * inverse + ageCurve // + 2 * isWrongExchange()
  }

  const out = {
    '@convertCurrency': { sync: true },
    convertCurrency (fromCurrency, toCurrency, amount = 1) {
      const rate = getExchangeRate(
        getState(),
        scorePair,
        fromCurrency,
        toCurrency
      )
      return amount * rate
    }
  }

  return out
}

// @flow
import type { FixedIo } from '../../io/fixIo.js'
import { wrapObject } from '../../util/api.js'
import type { ApiInput } from '../root.js'
import { getExchangeRate } from '../selectors.js'

/**
 * Creates an `ExchangeCache` API object.
 */
export function makeExchangeCache (ai: ApiInput) {
  const { onError } = ai.props

  return wrapObject(onError, 'ExchangeCache', makeExchangeCacheApi(ai))
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

    return 1 + 0.1 * inverse + ageCurve // + 2 * isWrongExchange()
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

export type ExchangeSwapRate = {
  pair: string,
  rate: string,
}

const API_PREFIX = 'https://shapeshift.io'

export function makeShapeshiftApi (io: FixedIo) {
  return {
    async getExchangeSwapRate (fromCurrency: string, toCurrency: string) {
      const pair = `${fromCurrency}_${toCurrency}`
      const reply = await io.fetch(`${API_PREFIX}/rate/${pair}`)
      const json: ExchangeSwapRate = await reply.json()

      return json
    }
  }
}

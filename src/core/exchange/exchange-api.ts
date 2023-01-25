import { bridgifyObject, onMethod } from 'yaob'

import { EdgeConvertCurrencyOpts, EdgeRateCache } from '../../types/types'
import { ApiInput } from '../root-pixie'
import { getExchangeRate } from './exchange-selectors'

const biasDefaults = {
  edgeRates: 0.15,
  nomics: 0.1,
  coincap: -0.05,
  coinbase: -0.1,
  coinmonitor: -0.2,
  wazirx: -0.15,
  constantRate: -0.25
}

/**
 * Creates an unwrapped exchange cache API object.
 */
export function makeExchangeCache(ai: ApiInput): EdgeRateCache {
  const out: EdgeRateCache = {
    on: onMethod,

    async convertCurrency(
      fromCurrency: string,
      toCurrency: string,
      amount: number = 1,
      opts: EdgeConvertCurrencyOpts = {}
    ): Promise<number> {
      const { biases = biasDefaults } = opts

      function getPairCost(
        source: string,
        age: number,
        inverse: boolean
      ): number {
        // The age curve goes from 0 to 1, with 1 being infinitely old.
        // The curve reaches half way (0.5) at 30 seconds in:
        const ageCurve = age / (30 + age)
        const bias = biases[source] != null ? biases[source] : 0
        return ageCurve + bias + (inverse ? 1.1 : 1)
      }

      const rate = getExchangeRate(
        ai.props.state,
        fromCurrency,
        toCurrency,
        getPairCost
      )
      return amount * rate
    }
  }
  bridgifyObject(out)

  return out
}

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getCurrencyMultiplier } from '../../../src/core/currency/currency-selectors'
import { fakeCurrencyPlugin } from '../../fake/fake-currency-plugin'

describe('currency selectors', function () {
  it('find currency multiplier', async function () {
    const { currencyInfo } = fakeCurrencyPlugin
    const tokens =
      fakeCurrencyPlugin.getBuiltinTokens != null
        ? await fakeCurrencyPlugin.getBuiltinTokens()
        : {}

    expect(getCurrencyMultiplier(currencyInfo, tokens, 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(currencyInfo, tokens, 'FAKE')).equals('100')
    expect(getCurrencyMultiplier(currencyInfo, tokens, 'TOKEN')).equals('1000')
    expect(getCurrencyMultiplier(currencyInfo, tokens, '-error-')).equals('1')
  })
})

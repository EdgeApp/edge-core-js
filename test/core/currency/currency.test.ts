import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getCurrencyMultiplier } from '../../../src/core/currency/currency-selectors'
import { fakeCurrencyPlugin } from '../../fake/fake-currency-plugin'

describe('currency selectors', function () {
  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(fakeCurrencyPlugin, {}, 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(fakeCurrencyPlugin, {}, 'FAKE')).equals('100')
    expect(getCurrencyMultiplier(fakeCurrencyPlugin, {}, 'TOKEN')).equals(
      '1000'
    )
    expect(getCurrencyMultiplier(fakeCurrencyPlugin, {}, '-error-')).equals('1')
  })
})

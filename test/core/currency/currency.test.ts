import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getCurrencyMultiplier } from '../../../src/core/currency/currency-selectors'
import { EdgeCurrencyPlugin, EdgePluginMap } from '../../../src/types/types'
import { fakeCurrencyPlugin } from '../../fake/fake-currency-plugin'

describe('currency selectors', function () {
  const plugins: EdgePluginMap<EdgeCurrencyPlugin> = {
    fakecoin: fakeCurrencyPlugin
  }

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(plugins, {}, 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(plugins, {}, 'FAKE')).equals('100')
    expect(getCurrencyMultiplier(plugins, {}, 'TOKEN')).equals('1000')
    expect(getCurrencyMultiplier(plugins, {}, '-error-')).equals('1')
  })
})

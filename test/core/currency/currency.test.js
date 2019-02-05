// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getCurrencyMultiplier } from '../../../src/core/currency/currency-selectors.js'
import { fakeCurrencyInfo } from '../../fake/fake-currency-plugin.js'

describe('currency selectors', function () {
  const infos = [fakeCurrencyInfo]

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(infos, [], 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(infos, [], 'FAKE')).equals('100')
    expect(getCurrencyMultiplier(infos, [], 'TOKEN')).equals('1000')
    expect(getCurrencyMultiplier(infos, [], '-error-')).equals('1')
  })
})

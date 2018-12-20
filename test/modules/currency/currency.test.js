// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { fakeUser, makeFakeContexts } from '../../../src/index.js'
import {
  getCurrencyMultiplier,
  hasCurrencyPlugin
} from '../../../src/modules/currency/currency-selectors.js'
import { expectRejection } from '../../expect-rejection.js'
import {
  fakeCurrencyInfo,
  fakeCurrencyPlugin
} from '../../fake/fake-currency-plugin.js'
import { brokenCurrencyPlugin } from '../../fake/fake-plugins.js'

const contextOptions = {
  apiKey: '',
  appId: ''
}

describe('currency selectors', function () {
  const infos = [fakeCurrencyInfo]

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(infos, [], 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(infos, [], 'FAKE')).equals('100')
    expect(getCurrencyMultiplier(infos, [], 'TOKEN')).equals('1000')
    expect(getCurrencyMultiplier(infos, [], '-error-')).equals('1')
  })

  it('has currency plugin', function () {
    expect(hasCurrencyPlugin(infos, 'wallet:fakecoin')).equals(true)
    expect(hasCurrencyPlugin(infos, 'wallet:nope')).equals(false)
  })
})

describe('currency pixie', function () {
  it('adds plugins', async function () {
    const [context] = await makeFakeContexts({
      ...contextOptions,
      localFakeUser: true,
      plugins: [fakeCurrencyPlugin]
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
  })

  it('handles errors gracefully', async function () {
    const [context] = await makeFakeContexts({
      ...contextOptions,
      localFakeUser: true,
      plugins: [brokenCurrencyPlugin]
    })
    return expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: Expect to fail'
    )
  })
})

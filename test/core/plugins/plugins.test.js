// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import { makeFakeEdgeWorld } from '../../../src/index.js'
import { expectRejection } from '../../expect-rejection.js'
import { fakeCurrencyPlugin } from '../../fake/fake-currency-plugin.js'
import {
  brokenCurrencyPlugin,
  brokenExchangePlugin,
  fakeExchangePlugin
} from '../../fake/fake-plugins.js'
import { fakeUser } from '../../fake/fake-user.js'

const contextOptions = { apiKey: '', appId: '' }

describe('plugins system', function () {
  it('adds plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: [fakeCurrencyPlugin, brokenExchangePlugin, fakeExchangePlugin],
      shapeshiftKey: '?'
    })
    const account = await context.loginWithPIN(fakeUser.username, fakeUser.pin)

    expect(Object.keys(account.currencyConfig)).deep.equals(['fakecoin'])
    expect(Object.keys(account.swapConfig)).deep.equals(['shapeshift', 'faast'])
  })

  it('cannot log in with broken plugins', async function () {
    const world = await makeFakeEdgeWorld([fakeUser])
    const context = await world.makeEdgeContext({
      ...contextOptions,
      plugins: [brokenCurrencyPlugin]
    })
    return expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: Expect to fail'
    )
  })
})

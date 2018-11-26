// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
  type EdgeCurrencyPluginFactory,
  fakeUser,
  makeFakeContexts,
  makeFakeIos
} from '../../../src/index.js'
import {
  getCurrencyMultiplier,
  hasCurrencyPlugin
} from '../../../src/modules/currency/currency-selectors.js'
import { makeCoreRoot } from '../../../src/modules/root.js'
import { expectRejection } from '../../expect-rejection.js'
import { fakeCurrencyInfo } from '../../fake-plugins/fake-currency-info.js'
import { makeFakeCurrency } from '../../fake-plugins/fake-currency.js'

describe('currency selectors', function () {
  const infos = [fakeCurrencyInfo]

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(infos, [], 'SMALL')).equals('10')
    expect(getCurrencyMultiplier(infos, [], 'TEST')).equals('100')
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
    const coreRoot = makeCoreRoot(makeFakeIos(1)[0], {
      apiKey: '',
      plugins: [makeFakeCurrency()]
    })

    // Wait for the plugins to appear:
    const output = await new Promise(resolve => {
      const unsubscribe = coreRoot.redux.subscribe(() => {
        if (coreRoot.output.currency.plugins != null) {
          unsubscribe()
          resolve(coreRoot.output.currency)
        }
      })
    })

    // Verify the output:
    expect(output.plugins.length).equals(1)
    expect(output.plugins[0].currencyInfo.walletTypes).deep.equals(
      fakeCurrencyInfo.walletTypes
    )

    // Verify the redux state:
    const infos = coreRoot.redux.getState().currency.infos
    expect(hasCurrencyPlugin(infos, 'wallet:fakecoin')).equals(true)
  })

  it('handles errors gracefully', async function () {
    const brokenPlugin: EdgeCurrencyPluginFactory = {
      pluginName: 'broken',
      pluginType: 'currency',
      makePlugin () {
        throw new Error('Expect to fail')
      }
    }
    const [context] = await makeFakeContexts({
      localFakeUser: true,
      plugins: [brokenPlugin]
    })
    return expectRejection(
      context.loginWithPIN(fakeUser.username, fakeUser.pin),
      'Error: Expect to fail'
    )
  })
})

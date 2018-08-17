// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { attachPixie, filterPixie } from 'redux-pixies'

import {
  fakeUser,
  makeFakeContexts,
  makeFakeIos
} from '../../../src/edge-core-index.js'
import type { EdgeCurrencyPluginFactory } from '../../../src/edge-core-index.js'
import currencyPixie from '../../../src/modules/currency/currency-pixie.js'
import {
  getCurrencyMultiplier,
  hasCurrencyPlugin
} from '../../../src/modules/currency/currency-selectors.js'
import { makeCoreRoot, makeRootProps } from '../../../src/modules/root.js'
import { fakeCurrencyInfo } from '../../fake-plugins/fake-currency-info.js'
import { makeFakeCurrency } from '../../fake-plugins/fake-currency.js'

describe('currency selectors', function () {
  const infos = [fakeCurrencyInfo]

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(infos, [], 'SMALL')).to.equal('10')
    expect(getCurrencyMultiplier(infos, [], 'TEST')).to.equal('100')
    expect(getCurrencyMultiplier(infos, [], 'TOKEN')).to.equal('1000')
    expect(getCurrencyMultiplier(infos, [], '-error-')).to.equal('1')
  })

  it('has currency plugin', function () {
    expect(hasCurrencyPlugin(infos, 'wallet:fakecoin')).to.equal(true)
    expect(hasCurrencyPlugin(infos, 'wallet:nope')).to.equal(false)
  })
})

describe('currency pixie', function () {
  it('adds plugins', async function () {
    const coreRoot = makeCoreRoot(makeFakeIos(1)[0], {
      plugins: [makeFakeCurrency()]
    })

    const output = await new Promise((resolve, reject) =>
      attachPixie(
        coreRoot.redux,
        filterPixie(currencyPixie, makeRootProps(coreRoot)),
        reject,
        output => {
          if (output.plugins) resolve(output)
        }
      )
    )

    // Verify the output:
    expect(output.plugins.length).to.equal(1)
    expect(output.plugins[0].currencyInfo.walletTypes).to.deep.equal(
      fakeCurrencyInfo.walletTypes
    )

    // Verify the redux state:
    const infos = coreRoot.redux.getState().currency.infos
    expect(hasCurrencyPlugin(infos, 'wallet:fakecoin')).to.equal(true)
  })

  it('handles errors gracefully', function () {
    const brokenPlugin: EdgeCurrencyPluginFactory = {
      pluginName: 'broken',
      pluginType: 'currency',
      makePlugin () {
        throw new Error('Expect to fail')
      }
    }
    const [context] = makeFakeContexts({
      localFakeUser: true,
      plugins: [brokenPlugin]
    })
    return context
      .loginWithPIN(fakeUser.username, fakeUser.pin)
      .then(
        ok => Promise.reject(new Error('Should fail')),
        e => expect(e.message).to.equal('Expect to fail')
      )
  })
})

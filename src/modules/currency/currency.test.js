// @flow

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { attachPixie, filterPixie } from 'redux-pixies'

import { fakeUser, makeFakeContexts } from '../../edge-core-index.js'
import type { EdgeCurrencyPluginFactory } from '../../edge-core-index.js'
import { makeFakeCurrency } from '../../fake-plugins/fakeCurrency.js'
import { fakeCurrencyInfo } from '../../fake-plugins/fakeCurrencyInfo.js'
import { makeFakeCoreRoots, makeRootProps } from '../root.js'
import currencyPixie from './currency-pixie.js'
import {
  getCurrencyMultiplier,
  hasCurrencyPlugin
} from './currency-selectors.js'

describe('currency selectors', function () {
  const infos = [fakeCurrencyInfo]

  it('find currency multiplier', function () {
    expect(getCurrencyMultiplier(infos, 'SMALL')).to.equal('10')
    expect(getCurrencyMultiplier(infos, 'TEST')).to.equal('100')
    expect(getCurrencyMultiplier(infos, 'TOKEN')).to.equal('1000')
    expect(getCurrencyMultiplier(infos, '-error-')).to.equal('1')
  })

  it('has currency plugin', function () {
    expect(hasCurrencyPlugin(infos, 'wallet:fakecoin')).to.equal(true)
    expect(hasCurrencyPlugin(infos, 'wallet:nope')).to.equal(false)
  })
})

describe('currency pixie', function () {
  it('adds plugins', async function () {
    const [coreRoot] = makeFakeCoreRoots({ plugins: [makeFakeCurrency()] })

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
